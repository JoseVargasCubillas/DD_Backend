import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

/**
 * Kinds de emails que pasan por la cola.
 * - migration_welcome: bulk one-time para migrar usuarios (no transaccional).
 * - lead_sat_guide, lead_media_kit, lead_estrategia_dossier,
 *   lead_resource_download, lead_newsletter_welcome: transaccionales,
 *   priorizados sobre el bulk.
 */
export type EmailQueueKind =
  | 'migration_welcome'
  | 'holding_offer'
  | 'lead_sat_guide'
  | 'lead_media_kit'
  | 'lead_estrategia_dossier'
  | 'lead_resource_download'
  | 'lead_newsletter_welcome'
  | 'user_credentials'
  | 'user_password_reset';

export interface IEmailQueueJobDocument extends SqlDocumentMethods<IEmailQueueJobDocument> {
  kind: EmailQueueKind;
  toEmail: string;
  toName?: string;
  // Solo aplica para migration_welcome — vacío en los demás.
  tempPassword?: string;
  // Payload libre para el kind concreto (resourceTitle, downloadUrl, phone, ...).
  payload?: Record<string, unknown>;
  // Vínculo con el lead cuando aplica, para poder marcar emailedAt al procesar.
  leadId?: string;
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

// Kinds transaccionales — priorizados sobre el bulk migration_welcome y
// tienen acceso a la reserva diaria (200 emails/dia).
export const TRANSACTIONAL_KINDS: EmailQueueKind[] = [
  'lead_sat_guide',
  'lead_media_kit',
  'lead_estrategia_dossier',
  'lead_resource_download',
  'lead_newsletter_welcome',
  'user_credentials',
  'user_password_reset',
];

