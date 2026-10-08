/**
 * CLI para correr el polling de HubSpot a mano.
 *
 * Uso:
 *   npm run hubspot:sync                       → una corrida real (emite boletos)
 *   npm run hubspot:sync -- --dry              → solo imprime lo que haría
 *   npm run hubspot:sync -- --dry --since=2026-10-01T00:00:00Z
 *                                              → dry-run mirando negocios desde esa fecha
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { runHubspotSyncOnce } from '../atomic/organisms/services/hubspot.service.js';

const dryRun = process.argv.includes('--dry') || process.env.DRY_RUN === '1';
const since = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length);

const main = async () => {
  await connectDB();
  try {
    const summary = await runHubspotSyncOnce({ dryRun, since });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('✖ Error en hubspot-sync:', err);
  process.exit(1);
});
