/**
 * Campaña única: Holding & Protección Patrimonial — Oferta de un día ($1,500).
 *
 * - Lee dos xlsx de HubSpot desde CAMPAIGN_DIR (por defecto /tmp/campaign-holding),
 *   NO persiste esos contactos en la DB, solo los usa para enviar.
 * - Fusiona con leads/users internos, dedupe por email y teléfono (con prioridad),
 *   personaliza el mensaje según el segmento y envía email + WhatsApp.
 * - Throttling propio para no quemar la cuenta Whapi ni el SMTP de Google.
 * - Guarda progreso en un CSV (log) y un state.json que permite reanudar.
 *
 * Uso en VPS:
 *   cd /var/www/dd-academia-backend
 *   node --enable-source-maps dist/scripts/campaign-holding-perpetua.js
 *
 * Variables opcionales:
 *   CAMPAIGN_DIR=/tmp/campaign-holding
 *   CAMPAIGN_DRY_RUN=1            # solo cuenta y previsualiza, no envía
 *   CAMPAIGN_SKIP_EMAIL=1
 *   CAMPAIGN_SKIP_WHATSAPP=1
 *   CAMPAIGN_EMAIL_CAP=1800       # cap por corrida (default 1800)
 *   CAMPAIGN_EMAIL_INTERVAL_MS=3000
 *   CAMPAIGN_ONLY_SEGMENTS=hubspot-holding,internal-estrategia-fiscal-dossier
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

import { connectDB } from '../config/database.js';
import { Lead } from '../atomic/molecules/models/lead.model.js';
import { User } from '../atomic/molecules/models/user.model.js';
import {
  sendHoldingOfferEmail,
} from '../atomic/organisms/services/email.service.js';
import {
  sendWhatsappMessage,
  isWhatsappBroadcastConfigured,
} from '../atomic/organisms/services/whatsapp.service.js';

// ── Config ─────────────────────────────────────────────────────
const CAMPAIGN_DIR = process.env.CAMPAIGN_DIR || '/tmp/campaign-holding';
const STATE_FILE = path.join(CAMPAIGN_DIR, 'state.json');
const LOG_FILE = path.join(CAMPAIGN_DIR, 'send-log.csv');
const DRY_RUN = process.env.CAMPAIGN_DRY_RUN === '1';
const SKIP_EMAIL = process.env.CAMPAIGN_SKIP_EMAIL === '1';
const SKIP_WHATSAPP = process.env.CAMPAIGN_SKIP_WHATSAPP === '1';
const EMAIL_CAP = Number(process.env.CAMPAIGN_EMAIL_CAP || 1800);
const EMAIL_INTERVAL_MS = Number(process.env.CAMPAIGN_EMAIL_INTERVAL_MS || 3000);
const WA_INTERVAL_MS = Number(process.env.CAMPAIGN_WA_INTERVAL_MS || 1500);
const ONLY_SEGMENTS = (process.env.CAMPAIGN_ONLY_SEGMENTS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const STRIPE_URL = 'https://buy.stripe.com/aFadR8djo87lc5Z4MIgjC3v';
const OFFER_PRICE_MXN = 1500;
const REGULAR_PRICE_MXN = 1997;
const EVENT_DATE_LABEL = '22 de septiembre';
const DEADLINE_LABEL = 'hoy a las 11:59 PM';

// ── Tipos ──────────────────────────────────────────────────────
type Segment =
  | 'hubspot-holding'
  | 'hubspot-ef-op'
  | 'internal-estrategia-fiscal-dossier'
  | 'internal-iniciativa-fiscal-2027'
  | 'internal-guia-blindaje-sat'
  | 'internal-holding'
  | 'internal-customer'
  | 'internal-newsletter'
  | 'internal-generic';

interface Contact {
  name: string;
  email: string;   // normalizado (lowercase, trim)
  phone: string;   // digits only, o ''
  segment: Segment;
  segmentSource: string; // texto informativo para logs
}

interface State {
  startedAt: string;
  emailsSent: number;
  waSent: number;
  emailedKeys: string[];   // emails ya enviados (para reanudar)
  waKeys: string[];        // phones ya enviados
}

// ── Utils ──────────────────────────────────────────────────────
const normalizeEmail = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase();

const normalizePhone = (raw: unknown): string => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  // MX 10 dígitos → 521<n> (Whapi lo prefiere para móvil).
  if (digits.length === 10) return `521${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `521${digits.slice(2)}`;
  return digits;
};

const readXlsx = (file: string): Record<string, unknown>[] => {
  const wb = XLSX.readFile(file);
  const sh = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sh);
};

const firstNameFrom = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
};

const properCase = (raw: string): string =>
  raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

// ── Segment copy ───────────────────────────────────────────────
const SEGMENT_CONTEXT: Record<Segment, string> = {
  'hubspot-holding':
    'ya consultaste con nosotros el tema de Holding & Protección Patrimonial',
  'hubspot-ef-op':
    'ya has estado con nosotros en sesiones de Estrategia Fiscal, Optimización, Reserva o Blindaje Patrimonial',
  'internal-estrategia-fiscal-dossier':
    'descargaste el Dossier de Estrategia Fiscal',
  'internal-iniciativa-fiscal-2027':
    'descargaste el documento Iniciativa Fiscal 2027',
  'internal-guia-blindaje-sat':
    'descargaste la Guía para blindarte del SAT',
  'internal-holding':
    'ya te habías interesado en Holding & Protección Patrimonial',
  'internal-customer':
    'ya eres parte de la comunidad de Diego Díaz',
  'internal-newsletter':
    'sigues las publicaciones y el mailing de Diego Díaz',
  'internal-generic':
    'ya conoces el trabajo de Diego Díaz',
};

const buildWhatsappMessage = (c: Contact): string => {
  const name = firstNameFrom(c.name) || 'Hola';
  const context = SEGMENT_CONTEXT[c.segment];
  return `Hola ${name}, soy del equipo de Diego Díaz.

Como ${context}, queremos regalarte una condición exclusiva SOLO por hoy: acceso a *Holding & Protección Patrimonial* con Diego Díaz a *$${OFFER_PRICE_MXN.toLocaleString('es-MX')} MXN* en lugar de $${REGULAR_PRICE_MXN.toLocaleString('es-MX')}.

📅 ${EVENT_DATE_LABEL} · 2.5 horas · 100% online
🎁 Sesión en vivo con Diego + material de apoyo + ruta para diagnóstico de tu caso.

Si tu empresa ya tiene activos, contratos, socios o varias sociedades, esta sesión te va a ordenar la operación antes de que un problema fiscal, legal o familiar te obligue a resolverlo bajo presión.

Aparta tu lugar con el precio exclusivo aquí 👉 ${STRIPE_URL}

⏰ La oferta cierra ${DEADLINE_LABEL}. No hay extensión.

¿Tienes dudas? Respóndeme por aquí y te ayudo directo.`;
};

// ── Load sources ───────────────────────────────────────────────
const HUBSPOT_COL = {
  name: 'Nombre',
  lastName: 'Apellidos',
  phone: 'Número de teléfono',
  email: 'Correo',
};

const loadHubspot = (
  file: string,
  segment: Segment,
): Contact[] => {
  if (!fs.existsSync(file)) return [];
  const rows = readXlsx(file);
  const out: Contact[] = [];
  for (const row of rows) {
    const email = normalizeEmail(row[HUBSPOT_COL.email]);
    if (!email || !email.includes('@')) continue;
    const phone = normalizePhone(row[HUBSPOT_COL.phone]);
    const fullName = properCase(
      `${String(row[HUBSPOT_COL.name] ?? '')} ${String(row[HUBSPOT_COL.lastName] ?? '')}`.trim(),
    );
    out.push({
      name: fullName,
      email,
      phone,
      segment,
      segmentSource: String(row['Detalle de la fuente del registro 1'] ?? ''),
    });
  }
  return out;
};

const loadInternalContacts = async (): Promise<Contact[]> => {
  const [leads, users] = await Promise.all([Lead.find({}), User.find({ isActive: true })]);
  const out: Contact[] = [];

  const leadSegment = (source: string): Segment => {
    switch (source) {
      case 'estrategia-fiscal-dossier': return 'internal-estrategia-fiscal-dossier';
      case 'iniciativa-fiscal-2027': return 'internal-iniciativa-fiscal-2027';
      case 'guia-blindaje-sat': return 'internal-guia-blindaje-sat';
      case 'libro-sat-waitlist': return 'internal-holding';
      case 'newsletter': return 'internal-newsletter';
      default: return 'internal-generic';
    }
  };

  for (const l of leads) {
    const email = normalizeEmail(l.email);
    if (!email) continue;
    out.push({
      name: properCase(String(l.name ?? '')),
      email,
      phone: normalizePhone(l.phone),
      segment: leadSegment(String(l.source)),
      segmentSource: `lead:${l.source}`,
    });
  }
  for (const u of users) {
    const email = normalizeEmail(u.email);
    if (!email) continue;
    const isCustomer = (u as any).contactStatus === 'customer';
    out.push({
      name: properCase(String(u.name ?? '')),
      email,
      phone: normalizePhone((u as any).phone),
      segment: isCustomer ? 'internal-customer' : 'internal-generic',
      segmentSource: `user:${(u as any).contactStatus ?? 'lead'}`,
    });
  }
  return out;
};

// ── Dedup: internal > hubspot-holding > hubspot-ef-op ──────────
const SEGMENT_PRIORITY: Record<Segment, number> = {
  'internal-customer': 100,
  'internal-estrategia-fiscal-dossier': 90,
  'internal-iniciativa-fiscal-2027': 85,
  'internal-guia-blindaje-sat': 80,
  'internal-holding': 78,
  'internal-newsletter': 70,
  'internal-generic': 60,
  'hubspot-holding': 50,
  'hubspot-ef-op': 40,
};

const dedupeContacts = (all: Contact[]): Contact[] => {
  const byKey = new Map<string, Contact>();
  const keep = (existing: Contact | undefined, next: Contact): Contact => {
    if (!existing) return next;
    const a = SEGMENT_PRIORITY[existing.segment];
    const b = SEGMENT_PRIORITY[next.segment];
    if (b > a) {
      // Preservamos el teléfono/nombre del más completo si el nuevo no los trae.
      return {
        ...next,
        name: next.name || existing.name,
        phone: next.phone || existing.phone,
      };
    }
    if (!existing.phone && next.phone) existing.phone = next.phone;
    if (!existing.name && next.name) existing.name = next.name;
    return existing;
  };

  for (const c of all) {
    const key = c.email;
    byKey.set(key, keep(byKey.get(key), c));
  }
  // Segunda pasada: si dos emails distintos tienen el mismo teléfono real,
  // dejamos solo la de mayor prioridad para no mandar 2 WhatsApp al mismo número.
  const byPhone = new Map<string, Contact>();
  const toRemove = new Set<string>();
  for (const c of byKey.values()) {
    if (!c.phone) continue;
    const prev = byPhone.get(c.phone);
    if (!prev) { byPhone.set(c.phone, c); continue; }
    const winner = SEGMENT_PRIORITY[c.segment] > SEGMENT_PRIORITY[prev.segment] ? c : prev;
    const loser = winner === c ? prev : c;
    // El perdedor pierde su teléfono, pero conserva el email para recibir mail.
    loser.phone = '';
    byPhone.set(c.phone, winner);
    // No borramos el email — sigue recibiendo correo.
    void toRemove;
  }
  return Array.from(byKey.values());
};

// ── State (reanudable) ────────────────────────────────────────
const loadState = (): State => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw) as State;
    }
  } catch (err) {
    console.warn('[state] no se pudo leer, empezando de cero:', (err as Error).message);
  }
  return {
    startedAt: new Date().toISOString(),
    emailsSent: 0,
    waSent: 0,
    emailedKeys: [],
    waKeys: [],
  };
};

const saveState = (state: State) => {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
};

const logLine = (row: string[]) => {
  const line = row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf8');
};

// ── Main ──────────────────────────────────────────────────────
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  console.log('[campaign] iniciando. dry-run:', DRY_RUN, 'dir:', CAMPAIGN_DIR);
  if (!fs.existsSync(CAMPAIGN_DIR)) fs.mkdirSync(CAMPAIGN_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) {
    logLine(['timestamp', 'channel', 'status', 'segment', 'name', 'email', 'phone', 'error']);
  }

  await connectDB();

  const efFile = path.join(CAMPAIGN_DIR, 'bd-ef-op-re-bp.xlsx');
  const holdingFile = path.join(CAMPAIGN_DIR, 'bd-holding.xlsx');

  const [ef, holding, internal] = await Promise.all([
    Promise.resolve(loadHubspot(efFile, 'hubspot-ef-op')),
    Promise.resolve(loadHubspot(holdingFile, 'hubspot-holding')),
    loadInternalContacts(),
  ]);

  console.log('[campaign] cargados — EF/OP:', ef.length, 'HOLDING:', holding.length, 'INTERNOS:', internal.length);

  let contacts = dedupeContacts([...internal, ...holding, ...ef]);
  if (ONLY_SEGMENTS.length > 0) {
    contacts = contacts.filter((c) => ONLY_SEGMENTS.includes(c.segment));
  }

  // Estadística por segmento.
  const stats = contacts.reduce<Record<string, { total: number; withPhone: number }>>((acc, c) => {
    acc[c.segment] = acc[c.segment] || { total: 0, withPhone: 0 };
    acc[c.segment].total += 1;
    if (c.phone) acc[c.segment].withPhone += 1;
    return acc;
  }, {});
  console.log('[campaign] final — total únicos:', contacts.length);
  console.table(stats);

  if (DRY_RUN) {
    console.log('[campaign] DRY_RUN — no se envía nada.');
    return;
  }

  const state = loadState();
  const emailedSet = new Set(state.emailedKeys);
  const waSet = new Set(state.waKeys);

  // 1) WhatsApp — más rápido, primero.
  if (!SKIP_WHATSAPP && isWhatsappBroadcastConfigured()) {
    console.log('[campaign] WhatsApp: comenzando');
    let sent = 0, failed = 0, skipped = 0;
    for (const c of contacts) {
      if (!c.phone) { skipped += 1; continue; }
      if (waSet.has(c.phone)) { skipped += 1; continue; }
      const body = buildWhatsappMessage(c);
      const outcome = await sendWhatsappMessage(c.phone, body);
      logLine([new Date().toISOString(), 'wa', outcome.status, c.segment, c.name, c.email, c.phone, outcome.error ?? '']);
      if (outcome.status === 'sent') {
        sent += 1;
        waSet.add(c.phone);
        state.waKeys.push(c.phone);
        state.waSent += 1;
      } else if (outcome.status === 'failed') { failed += 1; }
      else { skipped += 1; }
      if ((sent + failed) % 25 === 0) saveState(state);
      await delay(WA_INTERVAL_MS);
    }
    saveState(state);
    console.log(`[campaign] WhatsApp terminó — sent:${sent} failed:${failed} skipped:${skipped}`);
  } else if (SKIP_WHATSAPP) {
    console.log('[campaign] WhatsApp SKIP por env');
  } else {
    console.warn('[campaign] WhatsApp deshabilitado — WHAPI_TOKEN no configurado.');
  }

  // 2) Email — con cap prudente y throttle propio.
  if (!SKIP_EMAIL) {
    console.log('[campaign] Email: comenzando (cap:', EMAIL_CAP, ')');
    let sent = 0, failed = 0, skipped = 0;
    for (const c of contacts) {
      if (sent >= EMAIL_CAP) {
        console.log('[campaign] Email cap alcanzado en esta corrida. Reejecuta el script mañana para continuar.');
        break;
      }
      if (emailedSet.has(c.email)) { skipped += 1; continue; }
      try {
        await sendHoldingOfferEmail({
          email: c.email,
          name: c.name,
          contextLine: SEGMENT_CONTEXT[c.segment],
          stripeUrl: STRIPE_URL,
          offerPrice: OFFER_PRICE_MXN,
          regularPrice: REGULAR_PRICE_MXN,
          eventDateLabel: EVENT_DATE_LABEL,
          deadlineLabel: DEADLINE_LABEL,
        });
        logLine([new Date().toISOString(), 'email', 'sent', c.segment, c.name, c.email, c.phone, '']);
        sent += 1;
        emailedSet.add(c.email);
        state.emailedKeys.push(c.email);
        state.emailsSent += 1;
      } catch (err) {
        const msg = (err as Error).message;
        logLine([new Date().toISOString(), 'email', 'failed', c.segment, c.name, c.email, c.phone, msg]);
        failed += 1;
        console.error('[campaign] email fallo:', c.email, msg);
      }
      if ((sent + failed) % 25 === 0) saveState(state);
      await delay(EMAIL_INTERVAL_MS);
    }
    saveState(state);
    console.log(`[campaign] Email terminó — sent:${sent} failed:${failed} skipped:${skipped}`);
  } else {
    console.log('[campaign] Email SKIP por env');
  }

  console.log('[campaign] Totales acumulados — email:', state.emailsSent, 'wa:', state.waSent);
};

const isDirectRun = true;

if (isDirectRun) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[campaign] fatal:', err);
    process.exit(1);
  });
}
