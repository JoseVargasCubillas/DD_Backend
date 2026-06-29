import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface ITagDocument extends SqlDocumentMethods<ITagDocument> {
  name: string;
  slug: string;
  color: string;
  description?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Tag = createSqlModel<ITagDocument>({
  table: 'tags',
  defaults: () => ({
    color: '#0a0a0a',
    description: '',
  }),
});
