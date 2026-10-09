import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

// Tabla `hubspot_sync`: guarda el cursor del polling (kind 'state') y un
// registro por line item de HubSpot ya procesado (kind 'item'). La pareja
// dealId + lineItemId es la llave de idempotencia: un reinicio del servidor
// o un re-escaneo nunca duplica boletos.
export type HubspotSyncKind = 'state' | 'item';
// 'pending_event': el producto es válido pero aún no existe el Event en la DB;
// se reintenta cada ciclo y se emite en cuanto el evento aparezca.
export type HubspotItemStatus = 'issued' | 'skipped' | 'pending_event';

export interface IHubspotSyncDocument extends SqlDocumentMethods<IHubspotSyncDocument> {
  kind: HubspotSyncKind;
  // kind === 'state'
  cursor?: string;
  lastRunAt?: string;
  // kind === 'item'
  dealId?: string;
  lineItemId?: string;
  status?: HubspotItemStatus;
  reason?: string;
  productName?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  folios?: string[];
  // Eventos online con grupo de WhatsApp: producto y token de la invitación enviada.
  groupKey?: string;
  inviteToken?: string;
  // Datos del resumen de compra del correo de grupo (para reintentarlo igual).
  eventTitle?: string;
  eventDateLabel?: string;
  eventFormat?: string;
  amount?: number;
  emailSentAt?: string | null;
  emailAttempts?: number;
  emailLastError?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const HubspotSync = createSqlModel<IHubspotSyncDocument>({
  table: 'hubspot_sync',
  defaults: () => ({}),
});
