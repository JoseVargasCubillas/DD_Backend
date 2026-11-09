/**
 * Una sola vez: da de alta en la lista de asistentes (event_tickets, accessType
 * 'online') a quienes ya recibieron su invitación al grupo de WhatsApp de
 * Holding / SEF Online antes de que existiera la lista.
 *
 * Los datos del evento se recuperan de la venta de origen:
 *   · hubspot:<deal>:<item> → registro de hubspot_sync (+ búsqueda del evento)
 *   · web:<orden>:<índice>  → la orden y su item
 * Es idempotente: quien ya está en la lista se omite.
 *
 * Uso:
 *   npm run tickets:backfill-online            → solo muestra qué haría
 *   npm run tickets:backfill-online -- --apply → lo escribe, con pausas por el límite de Sheets
 *
 * Reparación (si una corrida anterior dejó inscritos en el evento equivocado o
 * filas sin escribir en el Sheet):
 *   npm run tickets:backfill-online -- --reset          → muestra qué borraría y volvería a crear
 *   npm run tickets:backfill-online -- --reset --apply  → borra los inscritos online que salieron de
 *     una invitación (y limpia su fila del Sheet) y los vuelve a crear bien en la misma corrida.
 *     Los inscritos online no tienen check-in, así que no se pierde asistencia.
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { EventGroupInvite, IEventGroupInviteDocument } from '../atomic/molecules/models/event-group-invite.model.js';
import { EventTicket } from '../atomic/molecules/models/event-ticket.model.js';
import { HubspotSync } from '../atomic/molecules/models/hubspot-sync.model.js';
import { Order } from '../atomic/molecules/models/order.model.js';
import { Event } from '../atomic/molecules/models/event.model.js';
import { findGroupEvent, parseProductName } from '../atomic/organisms/services/hubspot.service.js';
import { clearTicketRow, isAttendanceSheetEnabled, syncTicketRow } from '../atomic/organisms/services/attendance-sheet.service.js';
import { registerOnlineAttendee } from '../atomic/organisms/services/ticket.service.js';
import { groupLabel, GroupKey } from '../atomic/organisms/services/event-group.service.js';
import { formatEventDateLabel } from '../atomic/atoms/helpers/event-ticket.helper.js';

const apply = process.argv.includes('--apply');
const reset = process.argv.includes('--reset');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isQuota = (err: unknown): boolean => /quota exceeded|rate limit|429/i.test(String((err as Error)?.message ?? err));
// Pausa entre filas: Google Sheets deja ~60 escrituras por minuto por usuario.
const SHEET_PACE_MS = 4000;
const QUOTA_WAIT_MS = 65_000;

interface Resolved {
  eventRefId: string;
  eventSlug: string;
  eventTitle: string;
  eventDate: string;
  amount: number;
  advisorName: string;
}

const resolveHubspot = async (invite: IEventGroupInviteDocument): Promise<Resolved | null> => {
  const [, dealId, lineItemId] = invite.ref.split(':');
  const record = await HubspotSync.findOne({ kind: 'item', dealId, lineItemId });
  if (!record) return null;
  const parsed = parseProductName(record.productName);
  // Mismo criterio que la emisión: si el nombre del producto no coincide con el
  // título, se busca el evento online del mismo día y grupo.
  const event = parsed ? await findGroupEvent(parsed.name, parsed.date, invite.groupKey as GroupKey) : null;
  const fallback = parsed ? `${invite.groupKey}-${parsed.date}` : invite.groupKey;
  return {
    eventRefId: event?.refId ?? fallback,
    eventSlug: event?.slug ?? fallback,
    eventTitle: event?.title || record.eventTitle || groupLabel(invite.groupKey as GroupKey),
    eventDate: record.eventDateLabel || (event ? formatEventDateLabel(event.startDate, event.endDate) : ''),
    amount: record.amount ?? 0,
    advisorName: record.advisorName || '',
  };
};

const MONTHS_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

// "Viernes 16 de octubre de 2026" -> "2026-10-16" (null si no se entiende).
const isoFromLabel = (label: string): string | null => {
  const m = String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/(\d{1,2}) de ([a-z]+) de (\d{4})/);
  const month = m ? MONTHS_ES[m[2]] : undefined;
  return m && month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

const resolveWeb = async (invite: IEventGroupInviteDocument): Promise<Resolved | null> => {
  const [, orderId, idx] = invite.ref.split(':');
  const order = await Order.findById(orderId).then((o) => o, () => null);
  const item = order?.items?.[Number(idx)];
  if (!order || !item) return null;
  const event = item.eventId ? await Event.findById(item.eventId).then((e) => e, () => null) : null;
  if (event) {
    return {
      eventRefId: String(event._id),
      eventSlug: event.slug,
      eventTitle: event.title,
      eventDate: item.eventDate || formatEventDateLabel(event.startDate, event.endDate),
      amount: Number(item.price) || 0,
      advisorName: '',
    };
  }
  // Compras sin eventId (catálogo): se busca el evento online del mismo día y grupo,
  // igual que con HubSpot, para que no queden en una lista aparte con título largo.
  const iso = isoFromLabel(item.eventDate || '');
  const found = iso ? await findGroupEvent(item.title, iso, invite.groupKey as GroupKey) : null;
  if (found?.source === 'db') {
    return {
      eventRefId: found.refId,
      eventSlug: found.slug,
      eventTitle: found.title,
      eventDate: item.eventDate || formatEventDateLabel(found.startDate, found.endDate),
      amount: Number(item.price) || 0,
      advisorName: '',
    };
  }
  return {
    eventRefId: String(item.refId || ''),
    eventSlug: String(item.refId || ''),
    eventTitle: item.title,
    eventDate: item.eventDate || '',
    amount: Number(item.price) || 0,
    advisorName: '',
  };
};

const main = async () => {
  await connectDB();
  const stats = { invites: 0, alreadyListed: 0, duplicates: 0, created: 0, noSource: 0, failed: 0 };
  // Una persona por evento: si compró dos veces (o se reprocesó el negocio) hay
  // varias invitaciones del mismo correo, pero en la lista va una sola vez.
  const inviteRefs = new Set((await EventGroupInvite.find({})).map((i) => i.ref));
  // Con --reset: inscritos online que salieron de una invitación y se rehacen.
  const resetRefs = new Set<string>();
  if (reset) {
    for (const t of await EventTicket.find({})) {
      if (t.accessType !== 'online' || !inviteRefs.has(t.orderId)) continue;
      resetRefs.add(t.orderId);
      console.log(`${apply ? '- borra' : '[dry] borraría'} ${t.attendeeName} <${t.attendeeEmail}> · ${t.eventTitle} · ${t.eventDate}`);
      if (!apply) continue;
      try {
        if (t.sheetTab && t.sheetRow) { await clearTicketRow(t.sheetTab, t.sheetRow); await sleep(SHEET_PACE_MS); }
      } catch (err) {
        console.log(`  ! no se pudo limpiar la fila del Sheet de ${t.folio}: ${(err as Error).message.slice(0, 120)}`);
      }
      await EventTicket.findByIdAndDelete(String(t._id));
    }
    console.log(`reset: ${resetRefs.size} inscritos online ${apply ? 'borrados' : 'por borrar'}`);
  }
  const listed = new Set<string>();
  for (const t of await EventTicket.find({})) {
    if (t.accessType !== 'online' || resetRefs.has(t.orderId)) continue;
    const email = (t.attendeeEmail || '').trim().toLowerCase();
    listed.add(`${email}|${t.eventRefId}`);
    listed.add(`${email}|${t.eventSlug}`);
  }
  try {
    const invites = await EventGroupInvite.find({}).sort({ createdAt: 1 });
    stats.invites = invites.length;
    for (const invite of invites) {
      if (!resetRefs.has(invite.ref) && await EventTicket.findOne({ orderId: invite.ref })) { stats.alreadyListed += 1; continue; }
      const data = invite.ref.startsWith('hubspot:') ? await resolveHubspot(invite)
        : invite.ref.startsWith('web:') ? await resolveWeb(invite) : null;
      if (!data) {
        stats.noSource += 1;
        console.log(`· sin venta de origen: ${invite.ref} (${invite.email})`);
        continue;
      }
      const email = invite.email.trim().toLowerCase();
      if (listed.has(`${email}|${data.eventRefId}`) || listed.has(`${email}|${data.eventSlug}`)) {
        stats.duplicates += 1;
        console.log(`= ya está en ese evento: ${invite.email} · ${data.eventTitle} · ${data.eventDate}`);
        continue;
      }
      listed.add(`${email}|${data.eventRefId}`);
      listed.add(`${email}|${data.eventSlug}`);
      console.log(`${apply ? '+' : '[dry]'} ${invite.name} <${invite.email}> · ${data.eventTitle} · ${data.eventDate}${data.advisorName ? ` · ${data.advisorName}` : ''}`);
      if (!apply) { stats.created += 1; continue; }
      try {
        const ticket = await registerOnlineAttendee({
          ref: invite.ref,
          eventRefId: data.eventRefId,
          eventSlug: data.eventSlug,
          eventTitle: data.eventTitle,
          eventDate: data.eventDate,
          attendee: { name: invite.name, email: invite.email },
          amount: data.amount,
          advisorName: data.advisorName,
          purchasedAt: invite.createdAt,
        });
        stats.created += 1;
        if (isAttendanceSheetEnabled()) {
          // Si el Sheet rechazó la fila por límite de cuota, se espera y se reintenta.
          for (let attempt = 1; !ticket.sheetRow && attempt <= 3; attempt += 1) {
            console.log(`  … fila del Sheet pendiente (${ticket.folio}), reintento ${attempt}/3 en ${QUOTA_WAIT_MS / 1000} s`);
            await sleep(QUOTA_WAIT_MS);
            try {
              const res = await syncTicketRow(ticket);
              if (res) { ticket.sheetTab = res.tab; ticket.sheetRow = res.row; await ticket.save(); }
            } catch (err) {
              if (!isQuota(err)) { console.log(`  ✖ Sheet ${ticket.folio}: ${(err as Error).message.slice(0, 120)}`); break; }
            }
          }
          if (!ticket.sheetRow) { stats.failed += 1; console.log(`  ✖ ${ticket.folio} quedó en la lista pero sin fila en el Sheet`); }
          await sleep(SHEET_PACE_MS);
        }
      } catch (err) {
        stats.failed += 1;
        console.log(`  ✖ ${invite.ref}: ${(err as Error).message}`);
      }
    }
    console.log(JSON.stringify({ apply, ...stats }, null, 2));
  } finally {
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('✖ Error en backfill-online-attendees:', err);
  process.exit(1);
});
