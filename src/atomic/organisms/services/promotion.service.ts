import { Promotion, IPromotionDocument, PromotionScope } from '../../molecules/models/promotion.model.js';
import { Course } from '../../molecules/models/course.model.js';
import { Package } from '../../molecules/models/package.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

const normalizePromotionInput = async (input: Partial<IPromotionDocument>) => {
  const scope: PromotionScope = input.scope === 'course' || input.scope === 'package' ? input.scope : 'all';
  const targetId = scope === 'all' ? '' : String(input.targetId || '').trim();
  if (scope !== 'all' && !targetId) throw err('Selecciona el curso o paquete de la promoción', 400);
  if (scope === 'course' && !(await Course.findById(targetId))) throw err('Curso no encontrado', 400);
  if (scope === 'package' && !(await Package.findById(targetId))) throw err('Paquete no encontrado', 400);
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
