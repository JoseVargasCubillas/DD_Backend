import { resolveMexicanStateCode } from '../../atoms/helpers/mexican-states.helper.js';
import { colonyMatches, lookupPostalCode, sameState } from './postal-code.service.js';

// Validación del domicilio de entrega compartida por la captura de asesores
// (shipment.service) y el checkout web de libros (payment.service), para que
// las dos entradas apliquen exactamente las mismas reglas.

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

// Envia exige telefono de 10 digitos; se aceptan prefijos 52 / 521 y se quitan.
export const normalizeMxPhone = (raw: unknown): string => {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('521')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
  return digits;
};

export interface DeliveryAddressInput {
  phone?: unknown;
  street?: unknown;
  colony?: unknown;
  postalCode?: unknown;
  city?: unknown;
  state?: unknown;
}

export interface DeliveryAddressCheck {
  // Bloquean: dato inexistente o inconsistente.
  errors: string[];
  // No bloquean: conviene confirmar con el cliente.
  warnings: string[];
  phone: string;
}

export const validateDeliveryAddress = async (input: DeliveryAddressInput): Promise<DeliveryAddressCheck> => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const phone = normalizeMxPhone(input.phone);
  const street = clean(input.street);
  const colony = clean(input.colony);
  const postalCode = String(input.postalCode ?? '').replace(/\D/g, '');
  const city = clean(input.city);
  const state = clean(input.state);

  if (phone.length !== 10) errors.push('El teléfono debe tener 10 dígitos (sin lada internacional).');

  if (street.length < 3) errors.push('Escribe la calle y el número del domicilio.');
  else {
    if (!/\d/.test(street)) warnings.push('La calle no trae número: la guía saldrá con "S/N". Confirma que sea correcto.');
    if (street.length > 60) warnings.push('La calle es muy larga; algunas paqueterías la recortan. Pasa referencias al campo de referencias.');
  }
  if (colony.length < 2) errors.push('Escribe la colonia.');
  if (city.length < 2) errors.push('Escribe la ciudad o municipio.');
  if (!/^\d{5}$/.test(postalCode)) errors.push('El código postal debe tener 5 dígitos.');
  if (!state || !resolveMexicanStateCode(state)) errors.push('Selecciona un estado válido.');

  // Contraste contra SEPOMEX: el CP debe existir y corresponder al estado
  // elegido. La colonia solo genera aviso porque las listas pueden estar
  // incompletas. Si el servicio de CP no responde, se omite sin bloquear.
  if (/^\d{5}$/.test(postalCode)) {
    const lookup = await lookupPostalCode(postalCode);
    if (lookup.status === 'not_found') {
      errors.push(`El código postal ${postalCode} no existe. Revísalo por favor.`);
    } else if (lookup.status === 'ok') {
      const { info } = lookup;
      if (resolveMexicanStateCode(state) && !sameState(state, info.state)) {
        errors.push(`El código postal ${postalCode} corresponde a ${info.state}, pero seleccionaste ${state}.`);
      }
      if (colony.length >= 2 && info.colonies.length && !colonyMatches(colony, info.colonies)) {
        const sample = info.colonies.slice(0, 5).join(', ');
        warnings.push(
          `La colonia "${colony}" no aparece para el CP ${postalCode}. Colonias de ese CP: ${sample}${info.colonies.length > 5 ? '…' : ''}. Confirma que sea correcta.`,
        );
      }
    }
  }

  return { errors, warnings, phone };
};
