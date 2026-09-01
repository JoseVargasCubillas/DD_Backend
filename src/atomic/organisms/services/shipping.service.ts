import { env } from '../../../config/env.js';
import { resolveMexicanStateCode } from '../../atoms/helpers/mexican-states.helper.js';
import { IOrderShippingAddress } from '../../molecules/models/order.model.js';

// Carriers confirmados con cobertura real en el sandbox de Envia — probados
// a mano contra api-test.envia.com/ship/rate/. Otros carriers del catalogo
// (ups, redpack, quiken, etc.) devolvieron error en sandbox; se puede ampliar
// esta lista cuando la cuenta pase a produccion.
const SUPPORTED_CARRIERS = ['fedex', 'estafeta', 'dhl', 'paquetexpress'];

const RATE_BASE = env.envia.env === 'production' ? 'https://api.envia.com' : 'https://api-test.envia.com';

export const isEnviaConfigured = (): boolean => Boolean(env.envia.token);

interface EnviaAddress {
  name: string;
  phone: string;
  street: string;
  number?: string;
  district?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface ShippingPackage {
  type: 'envelope' | 'box';
  content: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  declaredValue: number;
}

export interface ShippingRateOption {
  carrier: string;
  carrierDescription: string;
  service: string;
  serviceDescription: string;
  deliveryEstimate: string;
  deliveryDays: number;
  totalPrice: number;
  currency: string;
}

export interface ShippingLabel {
  carrier: string;
  service: string;
  trackingNumber: string;
  labelUrl: string;
  trackUrl: string;
  totalPrice: number;
  currency: string;
}

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

const originAddress = (): EnviaAddress => {
  const stateCode = resolveMexicanStateCode(env.envia.origin.state);
  if (!stateCode) throw makeError('Estado de origen de envío mal configurado', 500);
  return {
    name: env.envia.origin.name,
    phone: env.envia.origin.phone,
    street: env.envia.origin.street,
    number: env.envia.origin.number,
    district: env.envia.origin.district,
    city: env.envia.origin.city,
    state: stateCode,
    country: 'MX',
    postalCode: env.envia.origin.postalCode,
  };
};

export const toEnviaDestination = (shipping: IOrderShippingAddress): EnviaAddress => {
  const stateCode = resolveMexicanStateCode(shipping.state);
  if (!stateCode) throw makeError('Estado de envío no reconocido', 400);
  const { street, number } = splitStreetAndNumber(shipping.street);
  return {
    name: shipping.fullName,
    phone: shipping.phone,
    street,
    number,
    district: shipping.colony,
    city: shipping.city,
    state: stateCode,
    country: 'MX',
    postalCode: shipping.postalCode,
  };
};

// El formulario de checkout junta calle y numero en un solo campo de texto
// libre ("Av. Reforma 123"). Envia exige `number` por separado para generar
// la guia — se extrae el ultimo token con digitos; si no hay ninguno se manda
// "S/N" (sin numero), la convencion mexicana estandar para ese caso.
const splitStreetAndNumber = (streetInput: string): { street: string; number: string } => {
  const trimmed = String(streetInput || '').trim();
  const match = trimmed.match(/^(.*?)[\s,]+(\S*\d\S*)$/);
  if (match) return { street: match[1].trim(), number: match[2].trim() };
  return { street: trimmed, number: 'S/N' };
};

const toEnviaPackages = (packages: ShippingPackage[]) =>
  packages.map((pkg) => ({
    type: pkg.type,
    content: pkg.content,
    amount: 1,
    declaredValue: pkg.declaredValue,
    lengthUnit: 'CM',
    weightUnit: 'KG',
    weight: pkg.weightKg,
    dimensions: { length: pkg.lengthCm, width: pkg.widthCm, height: pkg.heightCm },
  }));

const enviaRequest = async (path: string, body: unknown): Promise<any> => {
  const res = await fetch(`${RATE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.envia.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
};

// El campo deliveryDate.dateDifference que regresa Envia no es confiable en
// sandbox (se probaron combinaciones reales donde un servicio "Día
// siguiente" traia dateDifference: 17) — se parsea el texto de
// deliveryEstimate ("Día siguiente", "1-2 días", "2-4 días") en su lugar,
// que es lo que de verdad se le promete al cliente.
const parseDeliveryDays = (estimate?: string): number => {
  const text = String(estimate || '').toLowerCase();
  if (text.includes('siguiente')) return 1;
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : 999;
};

// Consulta los 4 carriers con cobertura confirmada en paralelo y regresa las
// tarifas combinadas, ordenadas de la mas rapida a la mas lenta (el costo lo
// absorbe el saldo de la cuenta de Envia, no se le cobra al cliente — ver
// createPaymentIntent en payment.service.ts). Los carriers sin cobertura
// para ese origen/destino simplemente no aportan resultados — no se trata
// como error fatal, es normal que alguno falle por ruta.
export const getShippingRates = async (
  shipping: IOrderShippingAddress,
  packages: ShippingPackage[],
): Promise<ShippingRateOption[]> => {
  if (!isEnviaConfigured()) return [];

  const destination = toEnviaDestination(shipping);
  const origin = originAddress();
  const enviaPackages = toEnviaPackages(packages);

  const results = await Promise.allSettled(
    SUPPORTED_CARRIERS.map((carrier) =>
      enviaRequest('/ship/rate/', { origin, destination, packages: enviaPackages, shipment: { type: 1, carrier } }),
    ),
  );

  const rates: ShippingRateOption[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const payload = result.value;
    if (payload?.meta !== 'rate' || !Array.isArray(payload.data)) continue;
    for (const rate of payload.data) {
      if (!rate?.totalPrice) continue;
      // Los servicios "ocurre" (dropOff !== 0) requieren elegir una sucursal
      // del carrier para dejar el paquete — eso necesita su propio flujo de
      // seleccion de sucursal (Queries API) que no esta construido. Se
      // ofrecen solo los servicios puerta a puerta, que no lo requieren.
      if (rate.dropOff !== 0) continue;
      rates.push({
        carrier: rate.carrier,
        carrierDescription: rate.carrierDescription ?? rate.carrier,
        service: rate.service,
        serviceDescription: rate.serviceDescription ?? rate.service,
        deliveryEstimate: rate.deliveryEstimate ?? '',
        deliveryDays: parseDeliveryDays(rate.deliveryEstimate),
        totalPrice: Number(rate.totalPrice),
        currency: rate.currency ?? 'MXN',
      });
    }
  }

  return rates.sort((a, b) => a.deliveryDays - b.deliveryDays || a.totalPrice - b.totalPrice);
};

// Vuelve a cotizar server-side la combinacion carrier+service elegida por el
// cliente — el precio nunca se confia del front, se recalcula aqui (mismo
// principio que EVENT_TICKET_CATALOG en payment.service.ts).
export const getShippingRate = async (
  shipping: IOrderShippingAddress,
  packages: ShippingPackage[],
  carrier: string,
  service: string,
): Promise<ShippingRateOption> => {
  const rates = await getShippingRates(shipping, packages);
  const match = rates.find((r) => r.carrier === carrier && r.service === service);
  if (!match) throw makeError('La opción de envío seleccionada ya no está disponible', 400);
  return match;
};

// Se llama automaticamente cuando el pago de una orden con envio se confirma
// (ver confirmPayment en payment.service.ts) — genera la guia real en Envia
// y regresa numero de rastreo + PDF para adjuntar a la orden y al recibo.
export const generateShippingLabel = async (
  shipping: IOrderShippingAddress,
  packages: ShippingPackage[],
  carrier: string,
  service: string,
): Promise<ShippingLabel> => {
  const payload = await enviaRequest('/ship/generate/', {
    origin: originAddress(),
    destination: toEnviaDestination(shipping),
    packages: toEnviaPackages(packages),
    settings: { printFormat: env.envia.labelPrintFormat, printSize: env.envia.labelPrintSize },
    shipment: { type: 1, carrier, service },
  });

  const result = payload?.data?.[0];
  if (payload?.meta !== 'generate' || !result) {
    throw makeError(payload?.error?.message || 'No se pudo generar la guía de envío', 502);
  }

  return {
    carrier: result.carrier,
    service: result.service,
    trackingNumber: result.trackingNumber,
    labelUrl: result.label,
    trackUrl: result.trackUrl,
    totalPrice: Number(result.totalPrice),
    currency: result.currency ?? 'MXN',
  };
};
