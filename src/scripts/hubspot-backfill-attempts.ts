/**
 * Sube a HubSpot contactos que ya estaban en la base ANTES del alta automática.
 * Si el correo ya existe en HubSpot no se toca; si no, se crea como lead con
 * Origen web = "Web · <de dónde vino>". Quien ya compró NUNCA se sube.
 *
 * Modos:
 *   (sin --all)  Solo intentos de compra sin pagar: usuarios 'lead' con el tag
 *                "Pago incompleto: <producto>" → "Web · Pago incompleto: <producto>".
 *   --all        TODOS los que tenemos menos los compradores:
 *                  1. intentos de compra sin pagar,
 *                  2. usuarios registrados que siguen como 'lead' → "Web · Registro",
 *                  3. leads de la web (descargas, newsletter, lista de espera,
 *                     contacto) → "Web · Descarga: …", "Web · Newsletter", etc.
 *
 * Comprador = usuario en estado 'customer' o correo con una orden 'completed'
 * (por el correo de contacto de la orden o por su usuario). El equipo interno
 * (admin, staff, instructor) tampoco se sube.
 *
 * Uso:
 *   npm run hubspot:backfill-attempts -- --all --dry   → solo cuenta (lee HubSpot, no escribe)
 *   npm run hubspot:backfill-attempts -- --all         → sube de verdad
 *   Opcional: --limit=N para procesar solo N contactos.
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { User, IUserDocument } from '../atomic/molecules/models/user.model.js';
import { Tag } from '../atomic/molecules/models/tag.model.js';
import { Lead } from '../atomic/molecules/models/lead.model.js';
import { Order } from '../atomic/molecules/models/order.model.js';
import { ORDER_STATUS } from '../atomic/atoms/constants/status.constant.js';
import { ensureHubspotContact } from '../atomic/organisms/services/hubspot-contact.service.js';
import { leadSourceDetail } from '../atomic/organisms/services/lead.service.js';

const PREFIX = 'Pago incompleto: ';
const dryRun = process.argv.includes('--dry');
const all = process.argv.includes('--all');
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length)) || Infinity;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Kind = 'intento' | 'registro' | 'lead';
interface Candidate {
  kind: Kind;
  email: string;
  name?: string;
  phone?: string;
  sourceDetail: string;
  user?: IUserDocument;
  items?: string[];
}

const main = async () => {
  await connectDB();

  const tags = await Tag.find({});
  const itemByTagId = new Map(
    tags.filter((t) => t.name.startsWith(PREFIX)).map((t) => [String(t._id), t.name.slice(PREFIX.length)]),
  );
  const users = await User.find({});
  const emailByUserId = new Map(users.map((u) => [String(u._id), normalize(u.email)]));

  // Compradores: nunca se suben (por estado del usuario o por una orden completada).
  const buyers = new Set<string>();
  for (const u of users) if (u.contactStatus === 'customer') buyers.add(normalize(u.email));
  for (const order of await Order.find({ status: ORDER_STATUS.COMPLETED })) {
    if (order.contact?.email) buyers.add(normalize(order.contact.email));
    const userEmail = order.user ? emailByUserId.get(String(order.user)) : undefined;
    if (userEmail) buyers.add(userEmail);
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let excludedBuyers = 0;
  const add = (c: Candidate): void => {
    c.email = normalize(c.email);
    if (!EMAIL_RE.test(c.email) || seen.has(c.email)) return;
    if (buyers.has(c.email)) { excludedBuyers += 1; seen.add(c.email); return; }
    seen.add(c.email);
    candidates.push(c);
  };

  // 1) Intentos de compra sin pagar (siempre).
  for (const user of users) {
    if (user.contactStatus !== 'lead' || user.hubspotPending?.syncedAt) continue;
    const items = (user.tagIds ?? []).map((id) => itemByTagId.get(id)).filter((x): x is string => Boolean(x));
    if (!items.length) continue;
    add({
      kind: 'intento',
      email: user.email,
      name: user.name,
      phone: user.phone,
      sourceDetail: `Web · Pago incompleto: ${items.join(', ')}`.slice(0, 200),
      user,
      items,
    });
  }

  if (all) {
    // 2) Usuarios registrados que nunca compraron (solo cuentas de cliente, no equipo interno).
    for (const user of users) {
      if (user.role !== 'user' || user.contactStatus !== 'lead') continue;
      add({ kind: 'registro', email: user.email, name: user.name, phone: user.phone, sourceDetail: 'Web · Registro' });
    }
    // 3) Leads de la web: descargas, newsletter, lista de espera, contacto.
    for (const lead of await Lead.find({})) {
      add({
        kind: 'lead',
        email: lead.email,
        name: lead.name,
        phone: lead.phone,
        sourceDetail: leadSourceDetail(lead.source, lead.meta),
      });
    }
  }

  const count = (kind: Kind): number => candidates.filter((c) => c.kind === kind).length;
  console.log(`${dryRun ? '[DRY] ' : ''}modo: ${all ? 'TODOS menos compradores (--all)' : 'solo intentos de compra sin pagar'}`);
  console.log(
    `candidatos: ${candidates.length} (intentos sin pagar: ${count('intento')}, registrados: ${count('registro')}, leads web: ${count('lead')})`,
  );
  console.log(`excluidos por ser compradores: ${excludedBuyers}`);

  const stats: Record<Kind, { created: number; existing: number; skipped: number; failed: number }> = {
    intento: { created: 0, existing: 0, skipped: 0, failed: 0 },
    registro: { created: 0, existing: 0, skipped: 0, failed: 0 },
    lead: { created: 0, existing: 0, skipped: 0, failed: 0 },
  };
  let processed = 0;
  for (const c of candidates) {
    if (processed >= limit) break;
    processed += 1;
    try {
      const result = await ensureHubspotContact(
        { email: c.email, name: c.name, phone: c.phone, sourceDetail: c.sourceDetail },
        { dryRun },
      );
      stats[c.kind][result === 'created' ? 'created' : result === 'exists' ? 'existing' : 'skipped'] += 1;
      if (!dryRun && result !== 'skipped' && c.user) {
        await User.findByIdAndUpdate(String(c.user._id), {
          hubspotPending: { at: c.user.hubspotPending?.at ?? new Date().toISOString(), items: c.items ?? [], syncedAt: new Date().toISOString() },
        } as Partial<IUserDocument>);
      }
    } catch (err) {
      stats[c.kind].failed += 1;
      console.error(`  ✖ ${c.email}: ${(err as Error).message}`);
    }
    if (processed % 25 === 0) console.log(`  ${processed}/${Math.min(candidates.length, limit)}…`);
    await sleep(250);
  }
  console.log(JSON.stringify({ dryRun, all, ...stats }, null, 2));
  console.log(dryRun ? '(created = "se crearían"; existing = "ya estaban en HubSpot")' : '');
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✖ Error en hubspot-backfill-attempts:', err);
    process.exit(1);
  });
