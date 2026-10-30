/**
 * Una sola vez: pone el asesor / origen en los boletos ya emitidos (lista de
 * asistentes) y reescribe todas sus filas en el Excel de asistencia.
 *
 * Uso:
 *   npm run tickets:backfill-advisor -- --dry   → solo cuenta, no escribe nada
 *   npm run tickets:backfill-advisor            → aplica (≈2 s por boleto por el límite de Sheets)
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { backfillTicketOrigins } from '../atomic/organisms/services/hubspot.service.js';

const dryRun = process.argv.includes('--dry');

const main = async () => {
  await connectDB();
  try {
    const s = await backfillTicketOrigins({ dryRun });
    console.log(JSON.stringify({ dryRun, ...s }, null, 2));
  } finally {
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('✖ Error en backfill-ticket-advisors:', err);
  process.exit(1);
});
