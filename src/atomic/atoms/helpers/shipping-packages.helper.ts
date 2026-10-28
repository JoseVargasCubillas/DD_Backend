import type { ShippingPackage } from '../../organisms/services/shipping.service.js';

// Los libros del pedido se envian en el mismo sobre acolchado de 20x15cm que
// se usa siempre para este tipo de envio (ver paquete guardado "LIBROS" en
// Envia). Un sobre acolchado ya no cabe fisicamente pasado cierto peso, asi que
// pedidos grandes cambian a caja: el alto se apila por libro y largo/ancho
// toman el mayor de los items, igual que antes de introducir el sobre fijo.
const ENVELOPE_LENGTH_CM = 20;
const ENVELOPE_WIDTH_CM = 15;
const ENVELOPE_HEIGHT_CM = 2;
const ENVELOPE_MAX_WEIGHT_KG = 2;

// Forma minima que necesita el armado: la cumplen tanto los items de un pedido
// web como los libros de una captura de asesor.
export interface PackageItemInput {
  type: string;
  title: string;
  price: number;
  quantity?: number;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export const buildShippingPackages = (items: PackageItemInput[]): ShippingPackage[] => {
  const products = items.filter((i) => i.type === 'product');
  if (!products.length) return [];

  const totals = products.reduce(
    (acc, item) => {
      const quantity = item.quantity ?? 1;
      acc.weightKg += (item.weightKg ?? 0.5) * quantity;
      acc.heightCm += (item.heightCm ?? 3) * quantity;
      acc.lengthCm = Math.max(acc.lengthCm, item.lengthCm ?? 23);
      acc.widthCm = Math.max(acc.widthCm, item.widthCm ?? 16);
      acc.declaredValue += item.price * quantity;
      return acc;
    },
    { weightKg: 0, heightCm: 0, lengthCm: 0, widthCm: 0, declaredValue: 0 },
  );

  const weightKg = Math.round(totals.weightKg * 100) / 100;
  const content = products.map((p) => p.title).join(', ').slice(0, 100);
  const declaredValue = Math.round(totals.declaredValue * 100) / 100;
  const fitsEnvelope = weightKg <= ENVELOPE_MAX_WEIGHT_KG;

  return [
    {
      type: fitsEnvelope ? 'envelope' : 'box',
      content,
      weightKg,
      lengthCm: fitsEnvelope ? ENVELOPE_LENGTH_CM : totals.lengthCm,
      widthCm: fitsEnvelope ? ENVELOPE_WIDTH_CM : totals.widthCm,
      heightCm: fitsEnvelope ? ENVELOPE_HEIGHT_CM : Math.round(totals.heightCm * 100) / 100,
      declaredValue,
    },
  ];
};
