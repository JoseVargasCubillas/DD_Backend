import QRCode from 'qrcode';
import { EventTicket, IEventTicketDocument, TICKET_STATUS } from '../../molecules/models/event-ticket.model.js';
import { Event } from '../../molecules/models/event.model.js';
import { IOrderDocument } from '../../molecules/models/order.model.js';
import {
  buildTicketQrUrl,
  buildTicketUrl,
  generateFolio,
  normalizeFolio,
  signFolio,
  verifyFolioSignature,
} from '../../atoms/helpers/ticket-token.helper.js';
import { formatEventDateLabel, formatEventFormatLabel, formatTicketOrderRef, isHubspotOrderId } from '../../atoms/helpers/event-ticket.helper.js';
import * as attendanceSheet from './attendance-sheet.service.js';

export interface PublicTicket {
  folio: string;
  status: string;
  attendeeName: string;
  eventTitle: string;
  eventDate: string;
  eventFormat: string;
  eventSlug?: string;
  eventId?: string;
  amount: number;
  currency: string;
  purchasedAt: string;
  checkedInAt: string | null;
  seatIndex: number;
  seatTotal: number;
  // Id real de la orden (para enlazar el recibo); vacío si no hay recibo web.
  orderReference: string;
  // Código corto para mostrar: HP-<deal> (HubSpot) o WB-XXXXXXXX (web).
  orderLabel: string;
  url: string;
  qrUrl: string;
}

export interface AdminTicket extends PublicTicket {
  attendeeEmail: string;
  attendeePhone: string;
  orderId: string;
  checkedInBy: string | null;
}

export type CheckInResult = 'ok' | 'alreadyUsed' | 'invalid' | 'void';

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const toPublicTicket = (t: IEventTicketDocument): PublicTicket => ({
  folio: t.folio,
  status: t.status,
  attendeeName: t.attendeeName,
  eventTitle: t.eventTitle,
  eventDate: t.eventDate,
  eventFormat: t.eventFormat,
  eventSlug: t.eventSlug || undefined,
  eventId: t.eventRefId || undefined,
  amount: t.amount,
  currency: t.currency,
  purchasedAt: toIso(t.purchasedAt) ?? new Date().toISOString(),
  checkedInAt: toIso(t.checkedInAt),
  seatIndex: t.seatIndex,
  seatTotal: t.seatTotal,
  orderReference: isHubspotOrderId(t.orderId) ? '' : t.orderId,
  orderLabel: formatTicketOrderRef(t.orderId),
  url: buildTicketUrl(t.folio, t.signature),
  qrUrl: buildTicketQrUrl(t.folio, t.signature),
});

export const toAdminTicket = (t: IEventTicketDocument): AdminTicket => ({
  ...toPublicTicket(t),
  attendeeEmail: t.attendeeEmail,
  attendeePhone: t.attendeePhone,
  orderId: t.orderId,
  checkedInBy: t.checkedInBy,
});

const syncSheetBestEffort = async (ticket: IEventTicketDocument, mode: 'append' | 'update'): Promise<void> => {
  if (!attendanceSheet.isAttendanceSheetEnabled()) return;
  try {
    const result = mode === 'append'
      ? await attendanceSheet.appendTicketRow(ticket)
      : await attendanceSheet.syncTicketRow(ticket);
    if (result && (ticket.sheetRow !== result.row || ticket.sheetTab !== result.tab)) {
      ticket.sheetRow = result.row;
      ticket.sheetTab = result.tab;
      await ticket.save();
    }
  } catch (err) {
    console.warn(`[attendanceSheet:${mode}] ${ticket.folio}:`, (err as Error).message);
  }
};

// Resuelve datos de presentación del evento para un item de la orden. El
// refId puede ser el id de un Event en DB o el slug de catálogo del frontend.
const resolveEventMeta = async (item: IOrderDocument['items'][number]) => {
  let eventSlug = '';
  let eventDate = item.eventDate || '';
  let eventFormat = item.eventFormat || '';
  let eventModality: string | null = null;
  let title = item.title;
  const ref = String(item.refId || '');
  if (ref) {
    const event = UUID_RE.test(ref) ? await Event.findById(ref) : await Event.findOne({ slug: ref });
    if (event) {
      eventSlug = event.slug;
      eventModality = event.modality || null;
      title = event.title || title;
      eventDate = eventDate || formatEventDateLabel(event.startDate, event.endDate);
      eventFormat = eventFormat || formatEventFormatLabel(event.modality, event.location);
    } else if (!UUID_RE.test(ref)) {
      eventSlug = ref;
    }
  }
  return { eventSlug, eventDate, eventFormat, title, modality: eventModality };
};

// Solo los eventos presenciales (o híbridos) llevan boleto con QR. Con un
// Event en la DB manda su `modality`; si es de catálogo (sin Event) se infiere
// del formato/refId/título ("Online · Zoom", "...-online").
const isOnlineOnly = (
  meta: { modality: string | null; eventFormat: string; title: string },
  refId: string,
): boolean => {
  if (meta.modality) return meta.modality === 'online';
  return /online|en l[ií]nea|virtual/i.test(`${meta.eventFormat} ${refId} ${meta.title}`)
    && !/presencial|h[ií]brido/i.test(meta.eventFormat);
};

interface TicketBatchInput {
  orderId: string;
  orderItemIndex: number;
  seatTotal: number;
  eventRefId: string;
  eventSlug: string;
  eventTitle: string;
  eventDate: string;
  eventFormat: string;
  attendee: { name: string; email: string; phone: string };
  amount: number;
  currency: string;
  purchasedAt: Date | string;
  ticketType?: string;
}

// Crea un boleto por asiento y los agrega al Google Sheet de asistencia.
const issueTickets = async (input: TicketBatchInput): Promise<IEventTicketDocument[]> => {
  const sheetTab = attendanceSheet.buildTabTitle(input.eventTitle, input.eventDate);
  const created: IEventTicketDocument[] = [];

  for (let seat = 1; seat <= input.seatTotal; seat += 1) {
    let folio = generateFolio(input.eventTitle);
    // Colisión improbable (32^6) pero barata de evitar.
    while (await EventTicket.findOne({ folio })) folio = generateFolio(input.eventTitle);

    const ticket = await EventTicket.create({
      folio,
      signature: signFolio(folio),
      orderId: input.orderId,
      orderItemIndex: input.orderItemIndex,
      seatIndex: seat,
      seatTotal: input.seatTotal,
      eventRefId: input.eventRefId,
      eventSlug: input.eventSlug,
      eventTitle: input.eventTitle,
      eventDate: input.eventDate,
      eventFormat: input.eventFormat,
      attendeeName: input.attendee.name,
      attendeeEmail: input.attendee.email,
      attendeePhone: input.attendee.phone,
      amount: input.amount,
      currency: input.currency,
      purchasedAt: input.purchasedAt,
      status: TICKET_STATUS.VALID,
      sheetTab,
      ...(input.ticketType && { ticketType: input.ticketType }),
    });
    await syncSheetBestEffort(ticket, 'append');
    created.push(ticket);
  }
  return created;
};

// Genera un boleto por asiento para cada item de evento PRESENCIAL de la
// orden. Es idempotente: si la orden ya tiene boletos, los devuelve sin
// duplicar. Los items online no generan boleto.
export const createTicketsForOrder = async (
  order: IOrderDocument,
  attendee: { name: string; email: string; phone: string },
): Promise<IEventTicketDocument[]> => {
  const orderId = String(order._id);
  const existing = await EventTicket.find({ orderId }).sort({ orderItemIndex: 1, seatIndex: 1 });
  if (existing.length > 0) return existing;

  const eventItems = order.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === 'event');
  if (eventItems.length === 0) return [];

  const purchasedAt = order.paidAt ?? order.createdAt ?? new Date().toISOString();
  const created: IEventTicketDocument[] = [];

  for (const { item, index } of eventItems) {
    const meta = await resolveEventMeta(item);
    if (isOnlineOnly(meta, String(item.refId || ''))) continue;
    created.push(
      ...(await issueTickets({
        orderId,
        orderItemIndex: index,
        seatTotal: Math.max(1, Number(item.quantity) || 1),
        eventRefId: String(item.refId || ''),
        eventSlug: meta.eventSlug,
        eventTitle: meta.title,
        eventDate: meta.eventDate,
        eventFormat: meta.eventFormat,
        attendee,
        amount: Number(item.price) || 0,
        currency: order.currency || 'MXN',
        purchasedAt,
      })),
    );
  }
  return created;
};

// Boletos para una venta cerrada fuera de la página (negocio ganado en
// HubSpot). `externalRef` hace de orderId: "hubspot:<dealId>:<lineItemId>".
export const createTicketsForExternalSale = (input: Omit<TicketBatchInput, 'orderItemIndex' | 'orderId'> & {
  externalRef: string;
}): Promise<IEventTicketDocument[]> =>
  issueTickets({ ...input, orderId: input.externalRef, orderItemIndex: 0 });

// ¿Esta persona ya tiene boleto vigente para este evento (p. ej. compró en la
// página y además el asesor cerró el negocio)? Evita mandar dos QR.
export const findActiveTicketForEvent = async (
  email: string,
  eventKeys: string[],
): Promise<IEventTicketDocument | null> => {
  const wanted = new Set(eventKeys.filter(Boolean));
  const target = email.trim().toLowerCase();
  const all = await EventTicket.find({});
  return all.find((t) =>
    t.status !== TICKET_STATUS.VOID
    && (t.attendeeEmail || '').trim().toLowerCase() === target
    && (wanted.has(t.eventRefId) || wanted.has(t.eventSlug))) ?? null;
};

export const getTicketsForOrder = async (orderId: string): Promise<IEventTicketDocument[]> =>
  EventTicket.find({ orderId }).sort({ orderItemIndex: 1, seatIndex: 1 });

export const findTicketByFolio = async (rawFolio: string): Promise<IEventTicketDocument | null> => {
  const folio = normalizeFolio(rawFolio);
  return folio ? EventTicket.findOne({ folio }) : null;
};

// Boleto público: requiere folio + firma válida.
export const getPublicTicket = async (
  rawFolio: string,
  signature: unknown,
): Promise<{ ticket: PublicTicket | null; reason: 'notFound' | 'forbidden' | null }> => {
  const ticket = await findTicketByFolio(rawFolio);
  if (!ticket) return { ticket: null, reason: 'notFound' };
  if (!verifyFolioSignature(ticket.folio, signature)) return { ticket: null, reason: 'forbidden' };
  return { ticket: toPublicTicket(ticket), reason: null };
};

export const renderTicketQrPng = async (rawFolio: string, signature: unknown): Promise<Buffer | null> => {
  const ticket = await findTicketByFolio(rawFolio);
  if (!ticket || !verifyFolioSignature(ticket.folio, signature)) return null;
  return QRCode.toBuffer(buildTicketUrl(ticket.folio, ticket.signature), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 640,
    color: { dark: '#17130f', light: '#ffffff' },
  });
};

export const renderTicketQrDataUrl = async (ticket: IEventTicketDocument): Promise<string> =>
  QRCode.toDataURL(buildTicketUrl(ticket.folio, ticket.signature), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
    color: { dark: '#17130f', light: '#ffffff' },
  });

export const renderTicketQrBuffer = async (ticket: IEventTicketDocument): Promise<Buffer> =>
  QRCode.toBuffer(buildTicketUrl(ticket.folio, ticket.signature), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
    color: { dark: '#17130f', light: '#ffffff' },
  });

export const checkInTicket = async (
  rawFolio: string,
  signature: unknown,
  adminLabel: string,
): Promise<{ result: CheckInResult; ticket?: AdminTicket }> => {
  const ticket = await findTicketByFolio(rawFolio);
  if (!ticket) return { result: 'invalid' };
  // Con firma se valida; sin firma (folio dictado a mano por el admin) se
  // acepta porque el endpoint ya exige sesión de administrador.
  if (signature && !verifyFolioSignature(ticket.folio, signature)) return { result: 'invalid' };
  if (ticket.status === TICKET_STATUS.VOID) return { result: 'void', ticket: toAdminTicket(ticket) };
  if (ticket.status === TICKET_STATUS.USED) return { result: 'alreadyUsed', ticket: toAdminTicket(ticket) };

  ticket.status = TICKET_STATUS.USED;
  ticket.checkedInAt = new Date().toISOString();
  ticket.checkedInBy = adminLabel;
  await ticket.save();
  await syncSheetBestEffort(ticket, 'update');
  return { result: 'ok', ticket: toAdminTicket(ticket) };
};

export const undoCheckIn = async (rawFolio: string): Promise<AdminTicket | null> => {
  const ticket = await findTicketByFolio(rawFolio);
  if (!ticket) return null;
  if (ticket.status === TICKET_STATUS.USED) {
    ticket.status = TICKET_STATUS.VALID;
    ticket.checkedInAt = null;
    ticket.checkedInBy = null;
    await ticket.save();
    await syncSheetBestEffort(ticket, 'update');
  }
  return toAdminTicket(ticket);
};

export const listEventAttendees = async (eventIdOrSlug: string) => {
  const ref = String(eventIdOrSlug || '').trim();
  const event = UUID_RE.test(ref) ? await Event.findById(ref) : await Event.findOne({ slug: ref });
  const keys = new Set([ref, event?.slug, event ? String(event._id) : ''].filter(Boolean));

  const all = await EventTicket.find({}).sort({ purchasedAt: -1 });
  const tickets = all.filter((t) => keys.has(t.eventRefId) || keys.has(t.eventSlug));

  const first = tickets[0];
  const title = event?.title || first?.eventTitle || ref;
  const startDate = event ? toIso(event.startDate) : null;
  const tab = first?.sheetTab || (first ? attendanceSheet.buildTabTitle(first.eventTitle, first.eventDate) : '');
  const sheetUrl = tab ? await attendanceSheet.getTabUrl(tab) : attendanceSheet.attendanceSheetUrl();

  return {
    event: { id: event ? String(event._id) : ref, slug: event?.slug || first?.eventSlug || '', title, startDate, dateLabel: first?.eventDate || '' },
    summary: {
      total: tickets.length,
      checkedIn: tickets.filter((t) => t.status === TICKET_STATUS.USED).length,
    },
    sheetUrl,
    tickets: tickets.map(toAdminTicket),
  };
};
