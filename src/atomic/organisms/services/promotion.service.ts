import { Promotion, IPromotionDocument } from '../../molecules/models/promotion.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

export const listPromotions = async (): Promise<IPromotionDocument[]> => {
  const all = await Promotion.find({});
  return all.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

export const createPromotion = async (input: Partial<IPromotionDocument> & { code: string }): Promise<IPromotionDocument> => {
  const code = input.code?.trim().toUpperCase();
  if (!code) throw err('Código requerido', 400);
  const exists = await Promotion.findOne({ code });
  if (exists) throw err('Ese código ya existe', 409);
  return Promotion.create({ ...input, code });
};

export const updatePromotion = async (id: string, data: Partial<IPromotionDocument>): Promise<IPromotionDocument> => {
  const promo = await Promotion.findById(id);
  if (!promo) throw err('Promoción no encontrada', 404);
  const allowed: (keyof IPromotionDocument)[] = ['description', 'type', 'value', 'scope', 'targetId', 'expiresAt', 'maxUses', 'isActive'];
  for (const k of allowed) if ((data as any)[k] !== undefined) (promo as any)[k] = (data as any)[k];
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
