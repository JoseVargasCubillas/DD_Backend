import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export type LeadSource =
  | 'guia-blindaje-sat'
  | 'media-kit'
  | 'newsletter'
  | 'contact'
  | 'other';

export interface ILeadDocument extends SqlDocumentMethods<ILeadDocument> {
  email: string;
  source: LeadSource;
  name?: string;
  phone?: string;
  meta?: Record<string, unknown>;
  emailedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Lead = createSqlModel<ILeadDocument>({
  table: 'leads',
  defaults: () => ({
    source: 'other',
    meta: {},
    emailedAt: null,
  }),
});
