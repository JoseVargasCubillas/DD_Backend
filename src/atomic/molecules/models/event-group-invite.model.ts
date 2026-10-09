import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

// Tabla `event_group_invites`: una invitación de un solo uso al grupo de
// WhatsApp de un evento online (Holding / SEF Online). `ref` identifica la
// compra de origen y hace idempotente la emisión: reenviar un recibo o
// reprocesar un negocio de HubSpot nunca genera un enlace nuevo.
export interface IEventGroupInviteDocument extends SqlDocumentMethods<IEventGroupInviteDocument> {
  // "web:<orderId>:<índice>" o "hubspot:<dealId>:<lineItemId>"
  ref: string;
  groupKey: string;
  token: string;
  email: string;
  name: string;
  usedAt: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const EventGroupInvite = createSqlModel<IEventGroupInviteDocument>({
  table: 'event_group_invites',
  defaults: () => ({ usedAt: null }),
});
