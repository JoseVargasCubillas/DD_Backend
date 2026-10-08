/**
 * Regenera src/atomic/atoms/constants/event-catalog.constant.ts a partir del
 * calendario fijo del frontend (FALLBACK_CALENDAR_EVENTS en eventCalendar.ts).
 *
 * Uso (en tu máquina, con DD_Frontend junto a DD_Backend):
 *   npm run catalog:gen
 *   npm run catalog:gen -- --src=C:\ruta\a\eventCalendar.ts
 *
 * Correrlo cada vez que se agregue o cambie una edición en el calendario del
 * frontend, y commitear el archivo generado.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const srcArg = process.argv.find((a) => a.startsWith('--src='))?.slice('--src='.length);
const srcPath = resolve(srcArg ?? '../DD_Frontend/src/utils/eventCalendar.ts');
const outPath = resolve('src/atomic/atoms/constants/event-catalog.constant.ts');

const main = async () => {
  const mod = (await import(pathToFileURL(srcPath).href)) as {
    FALLBACK_CALENDAR_EVENTS: Array<Record<string, unknown>>;
  };
  const rows = mod.FALLBACK_CALENDAR_EVENTS.map((e) => ({
    title: String(e.title),
    slug: String(e.slug),
    startDate: String(e.startDate),
    ...(e.endDate ? { endDate: String(e.endDate) } : {}),
    location: String(e.location ?? ''),
    modality: (e.modality as string | undefined) ?? 'unknown',
  }));

  const body = `// GENERADO por \`npm run catalog:gen\` a partir del calendario fijo del frontend
// (DD_Frontend/src/utils/eventCalendar.ts). NO editar a mano: regenerar y commitear
// cuando cambie el calendario. Lo usa el polling de HubSpot para boletos de ediciones
// que viven solo en el calendario del sitio y no tienen fila en la tabla \`events\`.

export interface CatalogEvent {
  title: string;
  slug: string;
  startDate: string;
  endDate?: string;
  location: string;
  modality: 'in-person' | 'online' | 'hybrid' | 'unknown';
}

export const EVENT_CATALOG: CatalogEvent[] = ${JSON.stringify(rows, null, 2)} as CatalogEvent[];
`;
  writeFileSync(outPath, body, 'utf8');
  console.log(`✔ ${rows.length} eventos escritos en ${outPath}`);
};

main().catch((err) => {
  console.error('✖ No se pudo generar el catálogo:', err);
  process.exit(1);
});
