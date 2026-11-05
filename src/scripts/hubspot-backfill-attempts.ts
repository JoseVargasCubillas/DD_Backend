/**
 * Sube a HubSpot los intentos de compra ANTERIORES al worker diario: usuarios que
 * siguen como 'lead' (nunca pagaron) y tienen el tag "Pago incompleto: <producto>".
 * Si el correo ya existe en HubSpot no se toca; si no, se crea con
 * Origen web = "Web · Pago incompleto: <producto>".
 *
 * Uso:
 *   npm run hubspot:backfill-attempts -- --dry   → solo cuenta (lee HubSpot, no escribe)
 *   npm run hubspot:backfill-attempts            → sube de verdad
 *   Opcional: --limit=N para procesar solo N usuarios.
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { User, IUserDocument } from '../atomic/molecules/models/user.model.js';
import { Tag } from '../atomic/molecules/models/tag.model.js';
import { ensureHubspotContact } from '../atomic/organisms/services/hubspot-contact.service.js';

const PREFIX = 'Pago incompleto: ';
const dryRun = process.argv.includes('--dry');
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length)) || Infinity;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await connectDB();
  const tags = await Tag.find({});
  const itemByTagId = new Map(
    tags.filter((t) => t.name.startsWith(PREFIX)).map((t) => [String(t._id), t.name.slice(PREFIX.length)]),
  );
  const users = (await User.find({ contactStatus: 'lead' })).filter(
    (u) => !u.hubspotPending?.syncedAt && (u.tagIds ?? []).some((id) => itemByTagId.has(id)),
  );
  console.log(`${dryRun ? '[DRY] ' : ''}usuarios con intento de compra sin pagar: ${users.length}`);

  const stats = { created: 0, existing: 0, skipped: 0, failed: 0 };
  let processed = 0;
  for (const user of users) {
    if (processed >= limit) break;
    processed += 1;
    const items = (user.tagIds ?? []).map((id) => itemByTagId.get(id)).filter((x): x is string => Boolean(x));
    try {
      const result = await ensureHubspotContact(
        {
          email: user.email,
          name: user.name,
          phone: user.phone,
          sourceDetail: `Web · Pago incompleto: ${items.join(', ')}`.slice(0, 200),
        },
        { dryRun },
      );
      stats[result === 'created' ? 'created' : result === 'exists' ? 'existing' : 'skipped'] += 1;
      if (!dryRun && result !== 'skipped') {
        await User.findByIdAndUpdate(String(user._id), {
          hubspotPending: { at: user.hubspotPending?.at ?? new Date().toISOString(), items, syncedAt: new Date().toISOString() },
        } as Partial<IUserDocument>);
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`  ✖ ${user.email}: ${(err as Error).message}`);
    }
    if (processed % 25 === 0) console.log(`  ${processed}/${Math.min(users.length, limit)}…`);
    await sleep(250);
  }
  console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
  console.log(dryRun ? '(created = "se crearían")' : '');
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✖ Error en hubspot-backfill-attempts:', err);
    process.exit(1);
  });
