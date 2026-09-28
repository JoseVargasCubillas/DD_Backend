/**
 * Masterclass "El costo invisible de las 40 horas" — envio masivo a la base
 * interna de la plataforma (usuarios + leads propios). NO toca la base fria
 * de HubSpot (~67k). Se ejecuta desde el VPS y respeta throttling SMTP.
 *
 * Uso:
 *   node --enable-source-maps dist/scripts/masterclass-40hrs-blast.js invite
 *   node --enable-source-maps dist/scripts/masterclass-40hrs-blast.js reminder
 *   MASTERCLASS_LIVE_URL="https://youtube.com/live/..." \
 *     node --enable-source-maps dist/scripts/masterclass-40hrs-blast.js live
 *
 * Variables:
 *   MASTERCLASS_LIVE_URL     Requerida en modo "live" (link real del stream).
 *   MASTERCLASS_INTERVAL_MS  Delay entre correos (default 1200ms ≈ 3000/hora).
 *   MASTERCLASS_DRY_RUN=1    Solo cuenta y muestra sample, no envia.
 *   MASTERCLASS_CAP          Cap absoluto por corrida (default 5000).
 *   MASTERCLASS_STATE_DIR    Carpeta para state/log (default /tmp/mc-40hrs).
 *
 * El state.json guarda emails ya enviados por MODO para poder reanudar sin
 * duplicar. Modo "invite" y "reminder" comparten el mismo destinatario pero
 * NO se marcan cruzados: cada modo lleva su propio log.
 */

import '../config/load-env.js';
import fs from 'fs';
import path from 'path';
import { connectDB } from '../config/database.js';
import { Lead } from '../atomic/molecules/models/lead.model.js';
import { User } from '../atomic/molecules/models/user.model.js';
import {
  sendMasterclass40HrsInvite,
  sendMasterclass40HrsReminder,
  sendMasterclass40HrsLive,
} from '../atomic/organisms/services/email.service.js';

type Mode = 'invite' | 'reminder' | 'live';

const MODE = (process.argv[2] || '').toLowerCase() as Mode;
if (!['invite', 'reminder', 'live'].includes(MODE)) {
  console.error('Uso: masterclass-40hrs-blast.js <invite|reminder|live>');
  process.exit(1);
}

const STATE_DIR = process.env.MASTERCLASS_STATE_DIR || '/tmp/mc-40hrs';
const STATE_FILE = path.join(STATE_DIR, `${MODE}.state.json`);
const LOG_FILE = path.join(STATE_DIR, `${MODE}.log.csv`);
const INTERVAL_MS = Number(process.env.MASTERCLASS_INTERVAL_MS || 1200);
const CAP = Number(process.env.MASTERCLASS_CAP || 5000);
const DRY_RUN = process.env.MASTERCLASS_DRY_RUN === '1';
const LIVE_URL = String(process.env.MASTERCLASS_LIVE_URL || '').trim();

if (MODE === 'live' && !LIVE_URL) {
  console.error('MASTERCLASS_LIVE_URL requerida en modo live.');
  process.exit(1);
}

interface Contact {
  name: string;
  email: string;
  source: string;
}

interface State {
  startedAt: string;
  sent: number;
  sentKeys: string[];
}

// ── Utils ─────────────────────────────────────────────────────
const normalizeEmail = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (email: string): boolean => EMAIL_RE.test(email);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const loadState = (): State => {
  ensureDir(STATE_DIR);
  if (!fs.existsSync(STATE_FILE)) {
    return { startedAt: new Date().toISOString(), sent: 0, sentKeys: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
  } catch {
    return { startedAt: new Date().toISOString(), sent: 0, sentKeys: [] };
  }
};

const saveState = (state: State): void => {
  ensureDir(STATE_DIR);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

const logLine = (parts: (string | number)[]): void => {
  ensureDir(STATE_DIR);
  fs.appendFileSync(
    LOG_FILE,
    parts.map((p) => `"${String(p).replace(/"/g, '""')}"`).join(',') + '\n',
  );
};

// ── Carga de contactos internos ──────────────────────────────
const loadInternalContacts = async (): Promise<Contact[]> => {
  const [users, leads] = await Promise.all([
    User.find({ isActive: true }),
    Lead.find({}),
  ]);

  const byEmail = new Map<string, Contact>();

  // 1) Usuarios de la plataforma (customers + admins + leads registrados).
  for (const u of users) {
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      email,
      name: String(u.name || '').trim(),
      source: `user:${u.contactStatus || 'lead'}`,
    });
  }

  // 2) Leads propios de la plataforma (formularios internos, no HubSpot).
  //    Dedupe por email — un lead ya presente como user no se duplica.
  for (const l of leads) {
    const email = normalizeEmail(l.email);
    if (!email || !isValidEmail(email)) continue;
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      email,
      name: String(l.name || '').trim(),
      source: `lead:${l.source || 'other'}`,
    });
  }

  return Array.from(byEmail.values());
};

// ── Envio segun modo ─────────────────────────────────────────
const sendOne = async (contact: Contact): Promise<void> => {
  switch (MODE) {
    case 'invite':
      await sendMasterclass40HrsInvite({ email: contact.email, name: contact.name });
      return;
    case 'reminder':
      await sendMasterclass40HrsReminder({ email: contact.email, name: contact.name });
      return;
    case 'live':
      await sendMasterclass40HrsLive({ email: contact.email, name: contact.name, liveUrl: LIVE_URL });
      return;
  }
};

// ── Main ─────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  await connectDB();

  ensureDir(STATE_DIR);
  if (!fs.existsSync(LOG_FILE)) {
    logLine(['timestamp', 'status', 'source', 'name', 'email', 'error']);
  }

  const contacts = await loadInternalContacts();
  const state = loadState();
  const alreadySent = new Set(state.sentKeys);

  const pending = contacts.filter((c) => !alreadySent.has(c.email));

  console.log(`\n▲ Masterclass 40hrs · modo: ${MODE}`);
  console.log(`  Total interno: ${contacts.length}`);
  console.log(`  Ya enviados : ${alreadySent.size}`);
  console.log(`  Pendientes  : ${pending.length}`);
  console.log(`  Cap corrida : ${CAP}`);
  console.log(`  Intervalo   : ${INTERVAL_MS} ms`);
  console.log(`  Dry run     : ${DRY_RUN ? 'SI' : 'no'}`);
  if (MODE === 'live') console.log(`  Live URL    : ${LIVE_URL}`);

  if (DRY_RUN) {
    console.log('\nMuestra (primeros 8):');
    pending.slice(0, 8).forEach((c) => console.log(`  • [${c.source}] ${c.email} — ${c.name || '(sin nombre)'}`));
    console.log('\nSalida sin enviar (DRY_RUN=1).');
    process.exit(0);
  }

  const slice = pending.slice(0, CAP);
  console.log(`\n→ Enviando ${slice.length} correo(s)...\n`);

  let sent = 0;
  let failed = 0;
  const startTs = Date.now();

  for (const contact of slice) {
    try {
      await sendOne(contact);
      sent += 1;
      state.sent += 1;
      state.sentKeys.push(contact.email);
      logLine([new Date().toISOString(), 'ok', contact.source, contact.name || '', contact.email, '']);

      // Persistir state cada 25 envios (protege ante fallo del proceso).
      if (sent % 25 === 0) {
        saveState(state);
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
        console.log(`  ${sent}/${slice.length} enviados · ${elapsed}s`);
      }
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      logLine([new Date().toISOString(), 'error', contact.source, contact.name || '', contact.email, msg]);
      console.warn(`  ✗ ${contact.email} — ${msg}`);
    }

    if (INTERVAL_MS > 0) await sleep(INTERVAL_MS);
  }

  saveState(state);
  const totalElapsed = ((Date.now() - startTs) / 1000).toFixed(0);
  console.log(`\n✔ Listo. Enviados en esta corrida: ${sent} · fallidos: ${failed} · ${totalElapsed}s`);
  console.log(`  State: ${STATE_FILE}`);
  console.log(`  Log  : ${LOG_FILE}`);
  process.exit(0);
};

main().catch((err) => {
  console.error('Error en masterclass-40hrs-blast:', err);
  process.exit(1);
});
