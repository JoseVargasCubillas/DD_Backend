/**
 * Polling a HubSpot: cuando un asesor mueve un negocio del pipeline "Equipo
 * Comercial" a "Exitoso" y le agrega un producto presencial en "Elementos de
 * pedido", se emite el boleto con QR y se manda por correo (igual que una
 * compra en la página).
 *
 * Nombre del producto (elemento del pedido):
 *     YYYY-MM-DD | Nombre del producto | General | VIP | Online
 *   ej. "2026-09-26 | SEF GDL | VIP"
 * Solo se procesan los line items con ese formato — los miles de negocios
 * viejos (nombres con emojis, "SEF Online", etc.) se ignoran. "Online" nunca
 * genera boleto. Si el objeto Producto trae modalidad/descripción "online" tampoco.
 *
 * El evento debe existir en la tabla `events` (mismo día y título/slug que
 * contenga el nombre del producto). Si no existe, el item queda 'pending_event'
 * y se emite solo cuando se dé de alta el evento (máx. 60 días).
 *
 * Idempotencia: cada dealId + lineItemId queda en la tabla `hubspot_sync`.
 * Corte: la primera corrida fija el cursor en HUBSPOT_SYNC_START (o "ahora"),
 * así que nunca se reprocesa el histórico.
 */

import slugify from 'slugify';
import { env } from '../../../config/env.js';
import { getPool } from '../../../config/database.js';
import { Event, IEventDocument } from '../../molecules/models/event.model.js';
import { EventTicket, IEventTicketDocument } from '../../molecules/models/event-ticket.model.js';
import { HubspotSync, IHubspotSyncDocument } from '../../molecules/models/hubspot-sync.model.js';
import { buildTicketUrl } from '../../atoms/helpers/ticket-token.helper.js';
import { formatEventDateLabel, formatTicketOrderRef } from '../../atoms/helpers/event-ticket.helper.js';
import {
  createTicketsForExternalSale,
  findActiveTicketForEvent,
  renderTicketQrBuffer,
} from './ticket.service.js';
import { sendEventTicketsEmail } from './email.service.js';

const API = 'https://api.hubapi.com';
const OVERLAP_MS = 2 * 60 * 1000;
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_ATTEMPTS = 8;
const MX_TZ = 'America/Mexico_City';

type Json = Record<string, any>;
type Tier = 'General' | 'VIP' | 'Online';

export interface ParsedProductName {
  date: string; // YYYY-MM-DD
  name: string;
  tier: Tier;
}

// ---------------------------------------------------------------------------
// Nombre del producto
// ---------------------------------------------------------------------------

const stripEmoji = (value: string): string =>
  value.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

// Fecha: 2026-10-22 o con el mes en letras, 2026-OCT-22 / 2026-OCTUBRE-22
// (es/en, se leen las 3 primeras letras). Los asesores escriben ambas formas.
const MONTHS: Record<string, number> = {
  ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7,
  AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12,
};

const NAME_RE = /^(\d{4})-(\d{1,2}|[A-Za-z]{3,10})-(\d{1,2})\s*\|\s*(.+?)\s*\|\s*(General|VIP|Online)$/i;

export const parseProductName = (raw: unknown): ParsedProductName | null => {
  const match = stripEmoji(String(raw ?? '')).match(NAME_RE);
  if (!match) return null;
  const [, year, monthRaw, day, name, tierRaw] = match;
  const month = /^\d+$/.test(monthRaw) ? Number(monthRaw) : MONTHS[monthRaw.slice(0, 3).toUpperCase()];
  if (!month) return null;
  const date = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  // Valida que el día exista en ese mes (rechaza 2026-02-31).
  const check = new Date(Date.UTC(Number(year), month - 1, Number(day)));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== Number(day)) return null;
  const tier = (tierRaw.toLowerCase() === 'vip' ? 'VIP' : tierRaw.toLowerCase() === 'online' ? 'Online' : 'General') as Tier;
  return { date, name: name.trim(), tier };
};

const looksOnline = (text: string): boolean =>
  /online|en l[ií]nea|virtual/i.test(text) && !/presencial|h[ií]brido/i.test(text);

// ---------------------------------------------------------------------------
// Cliente HubSpot
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const hs = async (path: string, body?: Json): Promise<Json> => {
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${env.hubspot.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return (await res.json()) as Json;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * attempt);
      continue;
    }
    throw new Error(`HubSpot ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  }
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const batchRead = async (objectType: string, ids: string[], properties: string[]): Promise<Map<string, Json>> => {
  const map = new Map<string, Json>();
  for (const part of chunk([...new Set(ids)], 100)) {
    const data = await hs(`/crm/v3/objects/${objectType}/batch/read`, {
      properties,
      inputs: part.map((id) => ({ id })),
    });
    for (const row of (data.results ?? []) as Json[]) map.set(String(row.id), row.properties ?? {});
  }
  return map;
};

const associatedIds = async (fromType: string, toType: string, id: string): Promise<string[]> => {
  const data = await hs(`/crm/v4/associations/${fromType}/${toType}/batch/read`, { inputs: [{ id }] });
  const row = (data.results ?? [])[0] as Json | undefined;
  return ((row?.to ?? []) as Json[]).map((t) => String(t.toObjectId));
};

interface WonDeal {
  id: string;
  modifiedMs: number;
  closedAt: string | null;
}

const fetchWonDeals = async (sinceMs: number): Promise<WonDeal[]> => {
  const deals: WonDeal[] = [];
  let after: string | undefined;
  do {
    const data = await hs('/crm/v3/objects/deals/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: env.hubspot.pipelineId },
          { propertyName: 'dealstage', operator: 'EQ', value: env.hubspot.wonStageId },
          { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(sinceMs) },
        ],
      }],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      properties: ['dealname', 'hs_lastmodifieddate', 'closedate'],
      limit: 100,
      ...(after && { after }),
    });
    for (const row of (data.results ?? []) as Json[]) {
      deals.push({
        id: String(row.id),
        modifiedMs: new Date(row.properties?.hs_lastmodifieddate ?? Date.now()).getTime(),
        closedAt: row.properties?.closedate ?? null,
      });
    }
    after = data.paging?.next?.after;
  } while (after);
  return deals;
};

// ---------------------------------------------------------------------------
// Evento destino
// ---------------------------------------------------------------------------

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const mxDay = (value: Date | string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ }).format(new Date(value));

// Busca el Event de la DB por nombre + día. Coincide si el título/slug contiene
// el nombre del producto o un alias configurado (HUBSPOT_EVENT_ALIASES, p. ej.
// "SEF CDMX" -> "estrategia-fiscal-cdmx"). Sin coincidencia NO se emite el
// boleto: queda pendiente hasta que el evento exista en la tabla `events`.
const findEvent = async (name: string, date: string): Promise<IEventDocument | null> => {
  const wanted = norm(name);
  const aliases = env.hubspot.eventAliases[wanted] ?? [];
  const events = await Event.find({});
  return events.find((e) => {
    if (mxDay(e.startDate) !== date) return false;
    const title = norm(e.title);
    const slug = norm(e.slug);
    if (title.includes(wanted) || wanted.includes(title) || slug.includes(wanted) || wanted.includes(slug)) return true;
    return aliases.some((a) => title.includes(a) || slug.includes(a));
  }) ?? null;
};

// ---------------------------------------------------------------------------
// Procesamiento
// ---------------------------------------------------------------------------

export interface SyncSummary {
  dryRun: boolean;
  deals: number;
  issued: number;
  skipped: number;
  pendingEvent: number;
  emailsSent: number;
  retries: number;
  // true si otro proceso ya estaba sincronizando y este ciclo se omitió.
  lockedByOther?: boolean;
}

const log = (msg: string): void => console.log(`[hubspot-sync] ${msg}`);

const findItemRecord = async (dealId: string, lineItemId: string): Promise<IHubspotSyncDocument | null> =>
  HubspotSync.findOne({ kind: 'item', dealId, lineItemId });

const buildCards = async (tickets: IEventTicketDocument[]) =>
  Promise.all(tickets.map(async (t) => ({
    folio: t.folio,
    attendeeName: t.attendeeName,
    eventTitle: t.eventTitle,
    eventDate: t.eventDate,
    eventFormat: t.ticketType ? `${t.eventFormat} · ${t.ticketType}` : t.eventFormat,
    amount: t.amount,
    seatIndex: t.seatIndex,
    seatTotal: t.seatTotal,
    purchasedAt: t.purchasedAt,
    url: buildTicketUrl(t.folio, t.signature),
    qrCid: `qr-${t.folio.toLowerCase()}@diegodiaz.mx`,
    qrPng: await renderTicketQrBuffer(t),
  })));

// Manda (o reintenta) el correo de un item ya emitido.
const deliverEmail = async (record: IHubspotSyncDocument): Promise<boolean> => {
  const folios = record.folios ?? [];
  const tickets: IEventTicketDocument[] = [];
  for (const folio of folios) {
    const t = await EventTicket.findOne({ folio });
    if (t) tickets.push(t);
  }
  if (tickets.length === 0 || !record.attendeeEmail) return false;
  try {
    await sendEventTicketsEmail({
      name: tickets[0].attendeeName,
      email: record.attendeeEmail,
      reference: formatTicketOrderRef(`hubspot:${record.dealId}`),
      tickets: await buildCards(tickets),
    });
    record.emailSentAt = new Date().toISOString();
    record.emailLastError = '';
    await record.save();
    return true;
  } catch (err) {
    record.emailAttempts = (record.emailAttempts ?? 0) + 1;
    record.emailLastError = String((err as Error).message ?? err).slice(0, 300);
    await record.save();
    log(`correo falló (${record.attendeeEmail}, intento ${record.emailAttempts}): ${record.emailLastError}`);
    return false;
  }
};

const retryPendingEmails = async (): Promise<number> => {
  const pending = (await HubspotSync.find({ kind: 'item', status: 'issued' }))
    .filter((r) => !r.emailSentAt && (r.emailAttempts ?? 0) < MAX_EMAIL_ATTEMPTS);
  let sent = 0;
  for (const record of pending) if (await deliverEmail(record)) sent += 1;
  return sent;
};

type DealResult = 'ok' | 'retry';

const processDeal = async (deal: WonDeal, dryRun: boolean, summary: SyncSummary): Promise<DealResult> => {
  const lineItemIds = await associatedIds('deals', 'line_items', deal.id);
  if (lineItemIds.length === 0) return 'ok';

  const lineItems = await batchRead('line_items', lineItemIds, [
    'name', 'quantity', 'price', 'description', 'hs_product_id', 'hs_line_item_currency_code',
  ]);

  // Solo line items con el formato nuevo y que no se hayan procesado.
  const candidates: Array<{ id: string; props: Json; parsed: ParsedProductName; pending?: IHubspotSyncDocument }> = [];
  for (const [id, props] of lineItems) {
    const parsed = parseProductName(props.name);
    if (!parsed) continue;
    const existing = await findItemRecord(deal.id, id);
    if (existing && existing.status !== 'pending_event') continue;
    candidates.push({ id, props, parsed, ...(existing && { pending: existing }) });
  }
  if (candidates.length === 0) return 'ok';

  const productIds = candidates.map((c) => String(c.props.hs_product_id ?? '')).filter(Boolean);
  const products = productIds.length
    ? await batchRead('products', productIds, ['name', 'description', env.hubspot.modalityProperty])
    : new Map<string, Json>();

  const contactIds = await associatedIds('deals', 'contacts', deal.id);
  const contacts = contactIds.length
    ? await batchRead('contacts', contactIds, ['firstname', 'lastname', 'email', 'phone', 'mobilephone'])
    : new Map<string, Json>();
  const contact = [...contacts.values()].find((c) => String(c.email ?? '').includes('@'));
  if (!contact) {
    log(`negocio ${deal.id}: sin contacto con correo asociado — se reintenta`);
    return 'retry';
  }
  const email = String(contact.email).trim().toLowerCase();
  const attendee = {
    name: `${contact.firstname ?? ''} ${contact.lastname ?? ''}`.trim() || email.split('@')[0],
    email,
    phone: String(contact.phone || contact.mobilephone || ''),
  };

  const markSkipped = async (c: (typeof candidates)[number], reason: string): Promise<void> => {
    summary.skipped += 1;
    log(`negocio ${deal.id} · "${c.props.name}" → omitido (${reason})`);
    if (dryRun) return;
    if (c.pending) {
      c.pending.status = 'skipped';
      c.pending.reason = reason;
      await c.pending.save();
      return;
    }
    await HubspotSync.create({
      kind: 'item', dealId: deal.id, lineItemId: c.id, status: 'skipped', reason,
      productName: String(c.props.name ?? ''), attendeeEmail: email,
    });
  };

  for (const c of candidates) {
    const { parsed } = c;
    if (parsed.tier === 'Online') { await markSkipped(c, 'entrada Online'); continue; }
    // Red de seguridad: un producto "SEF ONLINE | General" es un error de captura.
    if (/online/i.test(parsed.name)) { await markSkipped(c, 'el nombre del producto indica online'); continue; }

    // Modalidad: viene en la descripción (o propiedad de modalidad) del producto
    // y, si el elemento del pedido es personalizado, en su propia descripción.
    const product = products.get(String(c.props.hs_product_id ?? ''));
    const modalityText = `${product?.[env.hubspot.modalityProperty] ?? ''} ${product?.description ?? ''} ${c.props.description ?? ''}`;
    if (looksOnline(modalityText)) { await markSkipped(c, 'producto marcado como online'); continue; }

    const event = await findEvent(parsed.name, parsed.date);
    if (event?.modality === 'online') { await markSkipped(c, 'evento online en la DB'); continue; }

    if (!event) {
      // Sin Event en la DB no se emite boleto (evita QR para eventos mal escritos).
      summary.pendingEvent += 1;
      if (!c.pending) {
        log(`negocio ${deal.id} · "${c.props.name}" → PENDIENTE: no hay un evento "${parsed.name}" el ${parsed.date} en la DB; se emite cuando exista`);
        if (!dryRun) {
          await HubspotSync.create({
            kind: 'item', dealId: deal.id, lineItemId: c.id, status: 'pending_event',
            reason: `sin evento "${parsed.name}" el ${parsed.date}`,
            productName: String(c.props.name ?? ''), attendeeEmail: email,
          });
        }
      }
      continue;
    }

    const eventSlug = event.slug;
    const eventRefId = String(event._id);

    const dup = await findActiveTicketForEvent(email, [eventRefId, eventSlug]);
    if (dup) { await markSkipped(c, `ya tiene boleto ${dup.folio}`); continue; }

    const seatTotal = Math.max(1, Math.min(20, Number(c.props.quantity) || 1));
    summary.issued += 1;
    if (dryRun) {
      log(`[dry] negocio ${deal.id} · ${email} · ${parsed.name} ${parsed.date} · ${parsed.tier} × ${seatTotal}`);
      continue;
    }

    const tickets = await createTicketsForExternalSale({
      externalRef: `hubspot:${deal.id}:${c.id}`,
      seatTotal,
      eventRefId,
      eventSlug,
      eventTitle: event.title,
      eventDate: formatEventDateLabel(event.startDate, event.endDate),
      eventFormat: event.location ? `Presencial · ${event.location}` : 'Presencial',
      attendee,
      amount: Number(c.props.price) || 0,
      currency: String(c.props.hs_line_item_currency_code || 'MXN'),
      purchasedAt: deal.closedAt ?? new Date(deal.modifiedMs).toISOString(),
      ticketType: parsed.tier,
    });
    const issuedFields = {
      status: 'issued' as const,
      reason: '',
      productName: String(c.props.name ?? ''),
      attendeeEmail: email,
      folios: tickets.map((t) => t.folio),
      emailSentAt: null,
      emailAttempts: 0,
    };
    let record: IHubspotSyncDocument;
    if (c.pending) {
      Object.assign(c.pending, issuedFields);
      record = await c.pending.save();
    } else {
      record = await HubspotSync.create({ kind: 'item', dealId: deal.id, lineItemId: c.id, ...issuedFields });
    }
    log(`negocio ${deal.id} · ${email} · ${tickets.map((t) => t.folio).join(', ')}`);
    if (await deliverEmail(record)) summary.emailsSent += 1;
  }
  return 'ok';
};

const PENDING_EVENT_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

// Reintenta los items que esperaban a que el evento existiera en la DB.
const reprocessPendingEvents = async (summary: SyncSummary): Promise<void> => {
  const pending = await HubspotSync.find({ kind: 'item', status: 'pending_event' });
  const byDeal = new Map<string, IHubspotSyncDocument[]>();
  for (const r of pending) {
    if (r.dealId) byDeal.set(r.dealId, [...(byDeal.get(r.dealId) ?? []), r]);
  }
  const close = async (records: IHubspotSyncDocument[], reason: string): Promise<void> => {
    for (const r of records) {
      r.status = 'skipped';
      r.reason = reason;
      await r.save();
      summary.skipped += 1;
    }
  };
  for (const [dealId, records] of byDeal) {
    try {
      const data = await hs(`/crm/v3/objects/deals/${dealId}?properties=dealstage,pipeline,hs_lastmodifieddate,closedate`);
      const p = data.properties ?? {};
      const stillWon = p.pipeline === env.hubspot.pipelineId && p.dealstage === env.hubspot.wonStageId;
      if (!stillWon) { await close(records, 'el negocio ya no está en Exitoso'); continue; }
      const oldest = Math.min(...records.map((r) => new Date(String(r.createdAt)).getTime()));
      if (Date.now() - oldest > PENDING_EVENT_MAX_AGE_MS) { await close(records, 'sin evento en la DB tras 60 días'); continue; }
      await processDeal(
        { id: dealId, modifiedMs: new Date(p.hs_lastmodifieddate ?? Date.now()).getTime(), closedAt: p.closedate ?? null },
        false,
        summary,
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('HubSpot 404')) { await close(records, 'el negocio ya no existe en HubSpot'); continue; }
      log(`pendiente negocio ${dealId}: error — ${msg}`);
    }
  }
};

const loadState = async (): Promise<IHubspotSyncDocument | null> => HubspotSync.findOne({ kind: 'state' });

const runSyncCycle = async (opts: { dryRun?: boolean; since?: string } = {}): Promise<SyncSummary> => {
  const dryRun = Boolean(opts.dryRun);
  const summary: SyncSummary = { dryRun, deals: 0, issued: 0, skipped: 0, pendingEvent: 0, emailsSent: 0, retries: 0 };
  if (!env.hubspot.token) throw new Error('Falta HUBSPOT_TOKEN');

  let state = await loadState();
  let cursorIso = state?.cursor;
  if (!state) {
    const override = opts.since || env.hubspot.syncStart;
    const start = override ? new Date(override) : new Date();
    cursorIso = (Number.isNaN(start.getTime()) ? new Date() : start).toISOString();
    log(`primera corrida: cursor inicial ${cursorIso} (no se procesa histórico anterior)`);
    if (!dryRun) state = await HubspotSync.create({ kind: 'state', cursor: cursorIso, lastRunAt: new Date().toISOString() });
    // Sin fecha de corte explícita, la primera corrida solo fija el cursor.
    if (!override) return summary;
  }

  const cursorMs = new Date(cursorIso ?? Date.now()).getTime();
  const deals = await fetchWonDeals(cursorMs - OVERLAP_MS);
  summary.deals = deals.length;

  let maxOk = cursorMs;
  let earliestRetry: number | null = null;
  for (const deal of deals) {
    let result: DealResult;
    try {
      result = await processDeal(deal, dryRun, summary);
    } catch (err) {
      log(`negocio ${deal.id}: error — ${(err as Error).message}`);
      result = 'retry';
    }
    if (result === 'retry' && Date.now() - deal.modifiedMs > GIVE_UP_AFTER_MS) {
      log(`negocio ${deal.id}: se descarta tras 24 h sin resolverse`);
      result = 'ok';
    }
    if (result === 'retry') {
      summary.retries += 1;
      earliestRetry = earliestRetry === null ? deal.modifiedMs : Math.min(earliestRetry, deal.modifiedMs);
    } else {
      maxOk = Math.max(maxOk, deal.modifiedMs);
    }
  }

  if (!dryRun && state) {
    // Nunca se avanza más allá de un negocio que quedó pendiente.
    const next = earliestRetry === null ? maxOk : Math.min(maxOk, earliestRetry - 1);
    state.cursor = new Date(Math.max(cursorMs, next)).toISOString();
    state.lastRunAt = new Date().toISOString();
    await state.save();
    await reprocessPendingEvents(summary);
    summary.emailsSent += await retryPendingEmails();
  }
  return summary;
};

const LOCK_NAME = 'dd_hubspot_sync';

// Un solo proceso sincroniza a la vez (worker del servidor, varias instancias
// de pm2, o el script manual): el bloqueo de MySQL evita que dos corridas
// vean el mismo negocio como "no procesado" y emitan boletos duplicados. El
// bloqueo es por conexión, así que se usa una dedicada y MySQL lo libera solo
// si el proceso muere. El dry-run no escribe nada y no lo necesita.
export const runHubspotSyncOnce = async (opts: { dryRun?: boolean; since?: string } = {}): Promise<SyncSummary> => {
  if (opts.dryRun) return runSyncCycle(opts);

  const conn = await getPool().getConnection();
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
    const got = Number((rows as Array<{ got: number | null }>)[0]?.got) === 1;
    if (!got) {
      log('otro proceso ya está sincronizando — se omite este ciclo');
      return { dryRun: false, deals: 0, issued: 0, skipped: 0, pendingEvent: 0, emailsSent: 0, retries: 0, lockedByOther: true };
    }
    try {
      return await runSyncCycle(opts);
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
};

let workerStarted = false;
let running = false;

export const startHubspotSyncWorker = (): void => {
  if (workerStarted) return;
  if (!env.hubspot.token || !env.hubspot.syncEnabled) {
    console.log('[hubspot-sync] desactivado (sin HUBSPOT_TOKEN o HUBSPOT_SYNC_ENABLED=false)');
    return;
  }
  workerStarted = true;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const s = await runHubspotSyncOnce();
      if (s.issued || s.skipped || s.retries || s.pendingEvent) {
        log(`ciclo: ${s.deals} negocios · ${s.issued} emitidos · ${s.skipped} omitidos · ${s.pendingEvent} esperando evento · ${s.emailsSent} correos · ${s.retries} pendientes`);
      }
    } catch (err) {
      console.error('[hubspot-sync] ciclo falló:', (err as Error).message);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), env.hubspot.pollIntervalMs);
  console.log(`[hubspot-sync] worker iniciado (cada ${Math.round(env.hubspot.pollIntervalMs / 1000)} s)`);
};
