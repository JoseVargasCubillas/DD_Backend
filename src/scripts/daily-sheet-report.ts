/**
 * CLI wrapper para sincronizar el Google Sheet de leads.
 *
 * Uso:
 *   npm run report:sheet-sync            → escribe al sheet
 *   npm run report:sheet-sync -- --dry   → solo imprime el snapshot
 *
 * Programado en el VPS via crontab:
 *   30 16 * * *  cd /var/www/dd-academia-backend && npm run report:sheet-sync
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { buildLeadsReport, syncLeadsReportToSheet } from '../atomic/organisms/services/leads-report.service.js';

const isDryRun = process.argv.includes('--dry') || process.env.DRY_RUN === '1';

const main = async () => {
  await connectDB();

  try {
    if (isDryRun) {
      const snap = await buildLeadsReport();
      console.log('▲ DRY RUN — snapshot calculado (no se escribe al sheet)');
      console.log(JSON.stringify(snap, null, 2));
      return;
    }

    console.log('▲ Sincronizando Google Sheet de leads...');
    const snap = await syncLeadsReportToSheet();
    console.log('✔ Sheet actualizado:');
    console.log(`  Mes           : ${snap.monthLabel}`);
    console.log(`  Descargas mes : ${snap.downloads.total}`);
    console.log(`    · Iniciativa Fiscal 2027   → ${snap.downloads.iniciativaFiscal}`);
    console.log(`    · Dossier Estrategia       → ${snap.downloads.dossierEstrategia}`);
    console.log(`    · Guia SAT                 → ${snap.downloads.guiaSat}`);
    console.log(`    · Centro de Recursos       → ${snap.downloads.centroRecursos}`);
    console.log(`    · Newsletter               → ${snap.downloads.newsletter}`);
    console.log(`  LEADS ORG DD  : ${snap.leadsOrgTotal}`);
    console.log(`  Intentos      : ${snap.purchaseAttempts.total}`);
    console.log(`    · Taller EF Online         → ${snap.purchaseAttempts.tallerEfOnline}`);
    console.log(`    · Entrepreneur             → ${snap.purchaseAttempts.entrepreneur}`);
    console.log(`    · Holding                  → ${snap.purchaseAttempts.holding}`);
    console.log(`    · Taller EF CDMX           → ${snap.purchaseAttempts.tallerEfCdmx}`);
  } finally {
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('✖ Error sincronizando sheet:', err);
  process.exit(1);
});
