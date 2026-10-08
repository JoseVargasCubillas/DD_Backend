import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export const TICKET_STATUS = {
  VALID: 'valid',
  USED: 'used',
  VOID: 'void',
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

// Un boleto por asiento comprado. Se genera al confirmarse el pago de una
// orden con items type === 'event' y es lo que codifica el QR del recibo.
export interface IEventTicketDocument extends SqlDocumentMethods<IEventTicketDocument> {
  folio: string;
  // Firma HMAC corta del folio — viaja en el QR (?t=) para que el boleto no
  // se pueda adivinar ni fabricar sólo con el folio.
  signature: string;
  orderId: string;
  orderItemIndex: number;
  seatIndex: number;
  seatTotal: number;
  // refId del item (id del Event en DB o slug de catálogo) + slug resuelto.
  eventRefId: string;
  eventSlug: string;
  eventTitle: string;
  eventDate: string;
  eventFormat: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone: string;
  amount: number;
  currency: string;
  purchasedAt: Date | string;
  status: TicketStatus;
  checkedInAt: Date | string | null;
  checkedInBy: string | null;
  // Fila (1-based) en la pestaña del Google Sheet de asistencia, si se sincronizó.
  sheetRow: number | null;
  sheetTab: string;
  // 'General' | 'VIP' cuando el boleto viene de un negocio de HubSpot.
  ticketType?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const EventTicket = createSqlModel<IEventTicketDocument>({
  table: 'event_tickets',
  defaults: () => ({
    orderItemIndex: 0,
    seatIndex: 1,
    seatTotal: 1,
    eventRefId: '',
    eventSlug: '',
    eventDate: '',
    eventFormat: '',
    attendeeEmail: '',
    attendeePhone: '',
    amount: 0,
    currency: 'MXN',
    status: TICKET_STATUS.VALID,
    checkedInAt: null,
    checkedInBy: null,
    sheetRow: null,
    sheetTab: '',
  }),
});
