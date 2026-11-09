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
 *   npm run tickets:backfill-online -- --apply → lo escribe (≈2 s por fila por el límite de Sheets)
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { EventGroupInvite, IEventGroupInviteDocument } from '../atomic/molecules/models/event-group-invite.model.js';
import { EventTicket } from '../atomic/molecules/models/event-ticket.model.js';
import { HubspotSync } from '../atomic/molecules/models/hubspot-sync.model.js';
import { Order } from '../atomic/molecules/models/order.model.js';
import { Event } from '../atomic/molecules/models/event.model.js';
import { findEvent, parseProductName } from '../atomic/organisms/services/hubspot.service.js';
import { registerOnlineAttendee } from '../atomic/organisms/services/ticket.service.js';
import { groupLabel, GroupKey } from '../atomic/organisms/services/event-group.service.js';
import { formatEventDateLabel } from '../atomic/atoms/helpers/event-ticket.helper.js';

const apply = process.argv.includes('--apply');

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
  const event = parsed ? await findEvent(parsed.name, parsed.date) : null;
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

const resolveWeb = async (invite: IEventGroupInviteDocument): Promise<Resolved | null> => {
  const [, orderId, idx] = invite.ref.split(':');
  const order = await Order.findById(orderId).then((o) => o, () => null);
  const item = order?.items?.[Number(idx)];
  if (!order || !item) return null;
  const event = item.eventId ? await Event.findById(item.eventId).then((e) => e, () => null) : null;
  return {
    eventRefId: event ? String(event._id) : String(item.refId || ''),
    eventSlug: event?.slug || String(item.refId || ''),
    eventTitle: event?.title || item.title,
    eventDate: item.eventDate || (event ? formatEventDateLabel(event.startDate, event.endDate) : ''),
    amount: Number(item.price) || 0,
    advisorName: '',
  };
};

const main = async () => {
  await connectDB();
  const stats = { invites: 0, alreadyListed: 0, created: 0, noSource: 0, failed: 0 };
  try {
    const invites = await EventGroupInvite.find({}).sort({ createdAt: 1 });
    stats.invites = invites.length;
    for (const invite of invites) {
      if (await EventTicket.findOne({ orderId: invite.ref })) { stats.alreadyListed += 1; continue; }
      const data = invite.ref.startsWith('hubspot:') ? await resolveHubspot(invite)
        : invite.ref.startsWith('web:') ? await resolveWeb(invite) : null;
      if (!data) {
        stats.noSource += 1;
        console.log(`· sin venta de origen: ${invite.ref} (${invite.email})`);
        continue;
      }
      console.log(`${apply ? '+' : '[dry]'} ${invite.name} <${invite.email}> · ${data.eventTitle} · ${data.eventDate}${data.advisorName ? ` · ${data.advisorName}` : ''}`);
      if (!apply) { stats.created += 1; continue; }
      try {
        await registerOnlineAttendee({
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
