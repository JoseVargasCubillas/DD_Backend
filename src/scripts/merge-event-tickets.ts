/**
 * Une los boletos de una misma edición que quedaron repartidos en dos eventos
 * (compra web con refId de nivel, "estrategia-fiscal-general", y ventas de
 * HubSpot con el slug del calendario) y, opcionalmente, anula boletos de prueba.
 *
 * Uso:
 *   npm run tickets:merge-edition -- --date 2026-11-06 --name "Taller de estrategia fiscal"
 *       → solo muestra qué haría (no escribe nada)
 *   npm run tickets:merge-edition -- --date 2026-11-06 --name "Taller de estrategia fiscal" \
 *       --void DD-TEFG-7UU9X --apply
 *       → aplica; --void anula (prefijo de folio, se puede repetir) y el resto se mueve
 *         a la edición canónica y a su pestaña del Sheet
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { EventTicket, TICKET_STATUS } from '../atomic/molecules/models/event-ticket.model.js';
import { findEvent } from '../atomic/organisms/services/hubspot.service.js';
import { formatEventDateLabel } from '../atomic/atoms/helpers/event-ticket.helper.js';
import * as attendanceSheet from '../atomic/organisms/services/attendance-sheet.service.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const valuesOf = (flag: string): string[] =>
  args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const date = valuesOf('--date')[0];
const name = valuesOf('--name')[0];
const voidPrefixes = valuesOf('--void').map((f) => f.toUpperCase());

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const main = async () => {
  if (!date || !name) throw new Error('Faltan --date YYYY-MM-DD y --name "<nombre del evento>"');
  await connectDB();

  const event = await findEvent(name, date);
  if (!event) throw new Error(`No hay un evento "${name}" el ${date} (ni en la DB ni en el calendario).`);
  const dateLabel = formatEventDateLabel(event.startDate, event.endDate);
  const tab = attendanceSheet.buildTabTitle(event.title, dateLabel);
  console.log(`Evento canónico: ${event.title} · ${dateLabel} (${event.source}, ref=${event.refId}, slug=${event.slug})`);
  console.log(`Pestaña canónica: ${tab}\n`);

  const wantedTitle = norm(name);
  const all = await EventTicket.find({});
  const isVoidTarget = (folio: string): boolean => voidPrefixes.some((p) => folio.toUpperCase().startsWith(p));
  // Los folios de --void se buscan directo: una prueba puede estar ya en la
  // edición canónica o con otra referencia y aun así hay que anularla.
  const strays = all.filter((t) =>
    isVoidTarget(t.folio)
    || (t.eventDate === dateLabel
      && norm(t.eventTitle).includes(wantedTitle)
      && t.eventRefId !== event.refId
      && t.eventSlug !== event.slug));

  for (const p of voidPrefixes) {
    if (!all.some((t) => t.folio.toUpperCase().startsWith(p))) console.warn(`⚠ --void ${p}: ningún boleto empieza con ese folio`);
  }
  if (strays.length === 0) console.log('No hay boletos fuera de la edición canónica.');

  for (const t of strays) {
    const toVoid = isVoidTarget(t.folio);
    const tier = t.ticketType || t.eventRefId.match(/-(general|vip)$/i)?.[1]?.replace(/^./, (c) => c.toUpperCase());
    const action = toVoid ? 'ANULAR' : 'MOVER';
    console.log(`${action} ${t.folio} · ${t.attendeeName} <${t.attendeeEmail}> · ${t.eventTitle} · ${t.sheetTab}#${t.sheetRow ?? '-'} · ${t.status}`);
    if (!apply) continue;

    if (toVoid) {
      t.status = TICKET_STATUS.VOID;
      await t.save();
      await attendanceSheet.syncTicketRow(t).catch((err) => console.warn(`  sheet: ${(err as Error).message}`));
      continue;
    }

    const oldTab = t.sheetTab;
    const oldRow = t.sheetRow;
    Object.assign(t, {
      eventRefId: event.refId,
      eventSlug: event.slug,
      eventTitle: event.title,
      eventDate: dateLabel,
      sheetTab: tab,
      sheetRow: null,
      ...(tier && { ticketType: tier }),
    });
    await t.save();
    try {
      if (oldTab && oldRow) await attendanceSheet.clearTicketRow(oldTab, oldRow);
      const placed = await attendanceSheet.syncTicketRow(t);
      if (placed) {
        t.sheetRow = placed.row;
        t.sheetTab = placed.tab;
        await t.save();
      }
    } catch (err) {
      console.warn(`  sheet: ${(err as Error).message}`);
    }
  }

  console.log(apply ? '\nListo.' : '\n(dry run: nada se escribió; agrega --apply para aplicar)');
};

main()
  .catch((err) => {
    console.error('✖ Error en merge-event-tickets:', err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
