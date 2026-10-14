import { Promotion, IPromotionDocument, PromotionScope, PromotionType } from '../../molecules/models/promotion.model.js';
import { Course } from '../../molecules/models/course.model.js';
import { Package } from '../../molecules/models/package.model.js';
import { Offer } from '../../molecules/models/offer.model.js';
import { Event } from '../../molecules/models/event.model.js';
import { Book } from '../../molecules/models/book.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

const SCOPES: PromotionScope[] = ['all', 'course', 'package', 'offer', 'event', 'book'];
// Eventos y libros pueden dejar el objetivo vacío: aplica a todos los de ese tipo.
const TARGET_OPTIONAL: PromotionScope[] = ['all', 'event', 'book'];

const normalizePromotionInput = async (input: Partial<IPromotionDocument>) => {
  const scope: PromotionScope = SCOPES.includes(input.scope as PromotionScope) ? (input.scope as PromotionScope) : 'all';
  const targetId = scope === 'all' ? '' : String(input.targetId || '').trim();
  if (!TARGET_OPTIONAL.includes(scope) && !targetId) throw err('Selecciona el producto de la promoción', 400);
  if (scope === 'course' && !(await Course.findById(targetId))) throw err('Curso no encontrado', 400);
  if (scope === 'package' && !(await Package.findById(targetId))) throw err('Paquete no encontrado', 400);
  if (scope === 'offer' && !(await Offer.findById(targetId))) throw err('Oferta no encontrada', 400);
  if (scope === 'event' && targetId && !(await Event.findById(targetId))) throw err('Evento no encontrado', 400);
  if (scope === 'book' && targetId && !(await Book.findById(targetId))) throw err('Libro no encontrado', 400);
  if (input.expiresAt) {
    const expiresAt = new Date(String(input.expiresAt));
    if (Number.isNaN(expiresAt.getTime())) throw err('Fecha de vencimiento inválida', 400);
  }
  return { scope, targetId };
};

export const listPromotions = async (): Promise<IPromotionDocument[]> => {
  const all = await Promotion.find({});
  return all.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

export const createPromotion = async (input: Partial<IPromotionDocument> & { code: string }): Promise<IPromotionDocument> => {
  const code = input.code?.trim().toUpperCase();
  if (!code) throw err('Código requerido', 400);
  const exists = await Promotion.findOne({ code });
  if (exists) throw err('Ese código ya existe', 409);
  const target = await normalizePromotionInput(input);
  return Promotion.create({ ...input, ...target, code });
};

export const updatePromotion = async (id: string, data: Partial<IPromotionDocument>): Promise<IPromotionDocument> => {
  const promo = await Promotion.findById(id);
  if (!promo) throw err('Promoción no encontrada', 404);
  const target = await normalizePromotionInput({ ...promo, ...data });
  const allowed: (keyof IPromotionDocument)[] = ['description', 'type', 'value', 'scope', 'targetId', 'expiresAt', 'maxUses', 'isActive'];
  for (const k of allowed) if ((data as any)[k] !== undefined) (promo as any)[k] = (data as any)[k];
  promo.scope = target.scope;
  promo.targetId = target.targetId;
  if (data.code) promo.code = data.code.trim().toUpperCase();
  return promo.save();
};

export const deletePromotion = async (id: string): Promise<void> => {
  const promo = await Promotion.findById(id);
  if (!promo) throw err('Promoción no encontrada', 404);
  await Promotion.findByIdAndDelete(id);
};

export const validatePromotion = async (code: string): Promise<IPromotionDocument> => {
  const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });
  if (!promo || !promo.isActive) throw err('Código inválido', 404);
  if (promo.expiresAt && new Date(String(promo.expiresAt)).getTime() < Date.now()) throw err('Código expirado', 410);
  if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) throw err('Código agotado', 410);
  return promo;
};

// Lo mínimo que necesita el cálculo de descuento de un item ya normalizado
// por payment.service (precio autoritativo del catálogo, nunca del cliente).
export interface DiscountableItem {
  type: string;
  refId: string;
  price: number;
  quantity?: number;
  packageId?: string;
  courseId?: string;
  offerId?: string;
  eventId?: string;
}

export interface AppliedPromotion {
  promotionId: string;
  code: string;
  description: string;
  type: PromotionType;
  value: number;
  discount: number;
}

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

const itemMatchesScope = (promo: IPromotionDocument, item: DiscountableItem): boolean => {
  if (promo.scope === 'all') return true;
  if (promo.scope === 'course') return (item.type === 'course' && item.refId === promo.targetId) || item.courseId === promo.targetId;
  if (promo.scope === 'package') return item.packageId === promo.targetId;
  if (promo.scope === 'offer') return item.offerId === promo.targetId;
  if (promo.scope === 'event') return item.type === 'event' && (!promo.targetId || item.refId === promo.targetId || item.eventId === promo.targetId);
  if (promo.scope === 'book') return item.type === 'product' && (!promo.targetId || item.refId === promo.targetId);
  return false;
};

// Valida el código y calcula cuánto descuenta sobre los items elegibles según
// su alcance. El descuento nunca supera el subtotal elegible (un monto fijo
// mayor al precio deja el item en $0, no en negativo).
export const applyPromotion = async (code: string, items: DiscountableItem[]): Promise<AppliedPromotion> => {
  const promo = await validatePromotion(code);
  const eligible = items.filter((i) => itemMatchesScope(promo, i));
  if (!eligible.length) throw err('Este código no aplica a los productos de tu pedido', 400);
  const eligibleSubtotal = eligible.reduce((sum, i) => sum + i.price * Math.max(1, Number(i.quantity ?? 1)), 0);
  const raw = promo.type === 'percentage' ? eligibleSubtotal * (Number(promo.value) / 100) : Number(promo.value);
  const discount = roundMoney(Math.min(Math.max(raw, 0), eligibleSubtotal));
  if (!(discount > 0)) throw err('Este código no genera descuento en tu pedido', 400);
  return {
    promotionId: String(promo._id),
    code: promo.code,
    description: promo.description || '',
    type: promo.type,
    value: Number(promo.value),
    discount,
  };
};

// Se llama sólo cuando el pago quedó confirmado (webhook / confirm), nunca al
// crear el intent — un checkout abandonado no debe consumir usos del código.
export const registerPromotionUse = async (promotionId: string): Promise<void> => {
  if (!promotionId) return;
  const promo = await Promotion.findById(promotionId);
  if (!promo) return;
  promo.usedCount = Number(promo.usedCount || 0) + 1;
  await promo.save();
};
