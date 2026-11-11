/**
 * Herramientas de admin sobre la lista de asistentes de un evento:
 *  · alta manual (boleto con QR o acceso al grupo de WhatsApp, según el evento);
 *  · baja (anula el boleto o revoca el enlace; se puede reactivar);
 *  · eliminar (solo altas manuales: lo que viene de HubSpot o de la web se da de
 *    baja, porque borrarlo haría que la sincronización lo volviera a emitir).
 *
 * Van en un servicio aparte porque combinan boletos, grupos de WhatsApp y correo.
 */

import { randomUUID } from 'node:crypto';
import { EventTicket, IEventTicketDocument, TICKET_STATUS } from '../../molecules/models/event-ticket.model.js';
import { Event } from '../../molecules/models/event.model.js';
import { EventGroupInvite } from '../../molecules/models/event-group-invite.model.js';
import { buildTicketUrl } from '../../atoms/helpers/ticket-token.helper.js';
import { formatEventDateLabel, formatEventFormatLabel, formatTicketOrderRef } from '../../atoms/helpers/event-ticket.helper.js';
import { planSeats } from '../../atoms/helpers/seat-plan.helper.js';
import { clearTicketRow, isAttendanceSheetEnabled } from './attendance-sheet.service.js';
import { loadCatalog } from './event-catalog.service.js';
import { eventGroupKey, issueGroupInvite } from './event-group.service.js';
import { sendEventGroupEmail, sendEventTicketsEmail } from './email.service.js';
import {
  AdminTicket,
  createTicketsForExternalSale,
  findTicketByFolio,
  loadSeatPool,
  renderTicketQrBuffer,
  syncSheetBestEffort,
  toAdminTicket,
} from './ticket.service.js';

// Error con código HTTP para que el controlador responda 400/404/409 sin adivinar.
export class AttendeeError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface TargetEvent {
  refId: string;
  slug: string;
  title: string;
  dateLabel: string;
  modality: string;
  location: string;
  groupUrl?: string;
}

// Evento de la lista: de la DB (por id o slug); si solo está en el calendario fijo,
// de ahí; y si no, de los datos de un boleto ya emitido a esa edición.
const resolveEvent = async (idOrSlug: string): Promise<TargetEvent> => {
  const ref = String(idOrSlug || '').trim();
  const db = UUID_RE.test(ref) ? await Event.findById(ref) : await Event.findOne({ slug: ref });
  if (db) {
    return {
      refId: String(db._id), slug: db.slug, title: db.title, dateLabel: formatEventDateLabel(db.startDate, db.endDate),
      modality: db.modality, location: db.location, groupUrl: db.whatsappGroupUrl,
    };
  }
  const cat = (await loadCatalog()).find((e) => e.slug === ref);
  if (cat) {
    const modality = cat.modality !== 'unknown' ? cat.modality : /online|virtual|zoom/i.test(`${cat.slug} ${cat.title}`) ? 'online' : 'in-person';
    return { refId: cat.slug, slug: cat.slug, title: cat.title, dateLabel: formatEventDateLabel(cat.startDate, cat.endDate ?? null), modality, location: cat.location };
  }
  const sample = (await EventTicket.find({})).find((t) => t.eventRefId === ref || t.eventSlug === ref);
  if (sample) {
    return {
      refId: sample.eventRefId || ref, slug: sample.eventSlug || ref, title: sample.eventTitle, dateLabel: sample.eventDate,
      modality: sample.accessType === 'online' ? 'online' : 'in-person', location: '',
    };
  }
  throw new AttendeeError(404, 'No se encontró el evento');
};

export interface AddAttendeeInput {
  eventIdOrSlug: string;
  name: string;
  email: string;
  phone?: string;
  // Precio que se muestra en el correo y en la lista; 0 si es cortesía.
  amount?: number;
  ticketType?: 'General' | 'VIP';
  sendEmail?: boolean;
  // Permite repetir un nombre que ya tiene boleto activo con ese correo.
  force?: boolean;
}

export interface AddAttendeeResult {
  ticket: AdminTicket;
  emailSent: boolean;
  emailError?: string;
}

export const addAttendee = async (input: AddAttendeeInput): Promise<AddAttendeeResult> => {
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  if (name.length < 2) throw new AttendeeError(400, 'Escribe el nombre del asistente');
  if (!EMAIL_RE.test(email)) throw new AttendeeError(400, 'Escribe un correo válido');
  const amount = Math.max(0, Number(input.amount) || 0);
  const phone = String(input.phone ?? '').trim();

  const event = await resolveEvent(input.eventIdOrSlug);
  const online = event.modality === 'online';
  const ref = `manual:${randomUUID()}`;

  // Duplicado: mismo nombre y correo con boleto activo (o alta manual con ese nombre).
  if (!input.force) {
    const plan = planSeats({ tickets: await loadSeatPool(event, online), email, lineRef: ref, desired: [name] });
    if (plan.missing.length === 0) {
      throw new AttendeeError(409, `${name} ya está inscrito con ese correo en este evento. Si es otra persona con el mismo nombre, confirma el alta.`);
    }
  }

  const sendEmail = input.sendEmail !== false;
  const meta = { eventRefId: event.refId, eventSlug: event.slug, eventTitle: event.title, eventDate: event.dateLabel };

  if (online) {
    const key = eventGroupKey({ title: event.title, slug: event.slug, modality: 'online', whatsappGroupUrl: event.groupUrl });
    if (!key) throw new AttendeeError(409, 'El evento es online pero no tiene enlace de grupo de WhatsApp (Admin → Eventos → "Grupo de WhatsApp").');
    const card = await issueGroupInvite({ ref, key, email, name, groupUrl: event.groupUrl, strict: true, amount, ...meta });
    if (!card) throw new AttendeeError(409, 'No se pudo generar la invitación al grupo');
    const ticket = await EventTicket.findOne({ orderId: ref });
    if (!ticket) throw new AttendeeError(500, 'No se pudo registrar al asistente');
    let emailSent = false;
    let emailError: string | undefined;
    if (sendEmail) {
      try {
        await sendEventGroupEmail({
          name, email, reference: formatTicketOrderRef(ref), groups: [card],
          title: event.title, eventDate: event.dateLabel,
          eventFormat: event.location ? `Online · ${event.location}` : 'Online', amount,
        });
        emailSent = true;
      } catch (err) {
        emailError = (err as Error).message;
      }
    }
    return { ticket: toAdminTicket(ticket), emailSent, emailError };
  }

  const tickets = await createTicketsForExternalSale({
    externalRef: ref,
    seatTotal: 1,
    ...meta,
    eventFormat: formatEventFormatLabel(event.modality as 'in-person' | 'online' | 'hybrid', event.location),
    attendee: { name, email, phone },
    amount,
    currency: 'MXN',
    purchasedAt: new Date().toISOString(),
    ...(input.ticketType && { ticketType: input.ticketType }),
  });
  const ticket = tickets[0];
  let emailSent = false;
  let emailError: string | undefined;
  if (sendEmail) {
    try {
      await sendEventTicketsEmail({
        name, email, reference: formatTicketOrderRef(ref),
        tickets: [{
          folio: ticket.folio, attendeeName: ticket.attendeeName, eventTitle: ticket.eventTitle, eventDate: ticket.eventDate,
          eventFormat: ticket.ticketType ? `${ticket.eventFormat} · ${ticket.ticketType}` : ticket.eventFormat,
          amount: ticket.amount, seatIndex: ticket.seatIndex, seatTotal: ticket.seatTotal, purchasedAt: ticket.purchasedAt,
          url: buildTicketUrl(ticket.folio, ticket.signature),
          qrCid: `qr-${ticket.folio.toLowerCase()}@diegodiaz.mx`,
          qrPng: await renderTicketQrBuffer(ticket),
        }],
      });
      emailSent = true;
    } catch (err) {
      emailError = (err as Error).message;
    }
  }
  return { ticket: toAdminTicket(ticket), emailSent, emailError };
};

const loadTicket = async (rawFolio: string): Promise<IEventTicketDocument> => {
  const ticket = await findTicketByFolio(rawFolio);
  if (!ticket) throw new AttendeeError(404, 'Boleto no encontrado');
  return ticket;
};

const setInviteRevoked = async (ticket: IEventTicketDocument, revoked: boolean): Promise<void> => {
  if (ticket.accessType !== 'online') return;
  const invite = await EventGroupInvite.findOne({ ref: ticket.orderId });
  if (!invite) return;
  invite.revokedAt = revoked ? new Date().toISOString() : null;
  await invite.save();
};

// Baja: el boleto queda anulado (el QR deja de valer en el escáner) o el enlace
// del grupo deja de abrir. No se borra: la sincronización con HubSpot lo ve como
// "ya atendido" y no lo vuelve a emitir. Se puede reactivar.
export const voidAttendee = async (rawFolio: string): Promise<AdminTicket> => {
  const ticket = await loadTicket(rawFolio);
  if (ticket.status === TICKET_STATUS.VOID) return toAdminTicket(ticket);
  if (ticket.status === TICKET_STATUS.USED) {
    throw new AttendeeError(409, 'Ya registró su entrada. Deshaz el check-in antes de darlo de baja.');
  }
  ticket.status = TICKET_STATUS.VOID;
  await ticket.save();
  await setInviteRevoked(ticket, true);
  await syncSheetBestEffort(ticket, 'update');
  return toAdminTicket(ticket);
};

export const reactivateAttendee = async (rawFolio: string): Promise<AdminTicket> => {
  const ticket = await loadTicket(rawFolio);
  if (ticket.status !== TICKET_STATUS.VOID) return toAdminTicket(ticket);
  ticket.status = TICKET_STATUS.VALID;
  await ticket.save();
  await setInviteRevoked(ticket, false);
  await syncSheetBestEffort(ticket, 'update');
  return toAdminTicket(ticket);
};

// Eliminar de verdad: solo altas manuales (un error de captura del admin). Lo de
// HubSpot o de la web queda como baja, que es reversible y no se reemite.
export const deleteAttendee = async (rawFolio: string): Promise<void> => {
  const ticket = await loadTicket(rawFolio);
  if (!/^manual:/i.test(ticket.orderId)) {
    throw new AttendeeError(409, 'Solo se pueden eliminar las altas hechas a mano. Este registro viene de HubSpot o de la web: dalo de baja.');
  }
  if (ticket.status === TICKET_STATUS.USED) {
    throw new AttendeeError(409, 'Ya registró su entrada. Deshaz el check-in antes de eliminarlo.');
  }
  if (ticket.accessType === 'online') {
    const invite = await EventGroupInvite.findOne({ ref: ticket.orderId });
    if (invite) await EventGroupInvite.findByIdAndDelete(String(invite._id));
  }
  if (isAttendanceSheetEnabled() && ticket.sheetTab && ticket.sheetRow) {
    try {
      await clearTicketRow(ticket.sheetTab, ticket.sheetRow);
    } catch (err) {
      console.warn(`[attendee-admin] no se pudo limpiar la fila del Sheet (${ticket.folio}):`, (err as Error).message);
    }
  }
  await EventTicket.findByIdAndDelete(String(ticket._id));
};
