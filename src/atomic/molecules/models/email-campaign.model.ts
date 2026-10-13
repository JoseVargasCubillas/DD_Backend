import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

// 'sending': el envío corre en segundo plano. 'failed': no se envió (ver `error`).
export type EmailCampaignStatus = 'sending' | 'sent' | 'failed';

// 'web': contactos de nuestra BD subidos a la audiencia web.
// 'mailchimp': una audiencia (o segmento) que ya vive en Mailchimp.
export type EmailCampaignSource = 'web' | 'mailchimp';

// Historial de campañas masivas enviadas por Mailchimp desde /admin/email.
export interface IEmailCampaignDocument extends SqlDocumentMethods<IEmailCampaignDocument> {
  subject: string;
  // HTML enviado (sin el pie que agrega Mailchimp). Las campañas anteriores a
  // esta función no lo tienen.
  html?: string;
  segment: string;
  segmentLabel?: string;
  // Las campañas anteriores al envío en segundo plano no traen estado: son 'sent'.
  status?: EmailCampaignStatus;
  error?: string;
  source?: EmailCampaignSource;
  audienceId?: string;
  audienceName?: string;
  // Contactos que resolvió nuestra BD para el segmento (o los esperados de la audiencia).
  totalTargets: number;
  // Destinatarios que Mailchimp aceptó (excluye bajas, rebotes y correos inválidos).
  recipientCount: number;
  mailchimpCampaignId: string;
  mailchimpSegmentId: number;
  syncErrors: number;
  sentBy?: string;
  sentAt: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const EmailCampaign = createSqlModel<IEmailCampaignDocument>({
  table: 'email_campaigns',
});
