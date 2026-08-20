import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IEmailQueueJobDocument extends SqlDocumentMethods<IEmailQueueJobDocument> {
  kind: 'migration_welcome';
  toEmail: string;
  toName: string;
  tempPassword: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError?: string;
  sentAt?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const EmailQueueJob = createSqlModel<IEmailQueueJobDocument>({
  table: 'email_queue_jobs',
  defaults: () => ({
    status: 'pending',
    attempts: 0,
  }),
});
