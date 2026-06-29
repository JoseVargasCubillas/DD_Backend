import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export type PromotionType = 'percentage' | 'fixed';
export type PromotionScope = 'all' | 'course' | 'package';

export interface IPromotionDocument extends SqlDocumentMethods<IPromotionDocument> {
  code: string;
  description: string;
  type: PromotionType;
  value: number;
  scope: PromotionScope;
  targetId: string;
  expiresAt: Date | string | null;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Promotion = createSqlModel<IPromotionDocument>({
  table: 'promotions',
  defaults: () => ({
    description: '',
    type: 'percentage',
    value: 10,
    scope: 'all',
    targetId: '',
    expiresAt: null,
    maxUses: 0,
    usedCount: 0,
    isActive: true,
  }),
});
