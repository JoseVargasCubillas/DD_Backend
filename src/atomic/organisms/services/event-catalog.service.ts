/**
 * Calendario fijo de ediciones (copia del frontend) que usa el polling de
 * HubSpot cuando una edición no tiene fila en la tabla `events`.
 *
 * Fuente: la tabla `event_catalog`, que llena el botón "Actualizar calendario"
 * del admin (el frontend manda su FALLBACK_CALENDAR_EVENTS). Si la tabla está
 * vacía se usa el archivo generado event-catalog.constant.ts como respaldo.
 */

import { EVENT_CATALOG, CatalogEvent } from '../../atoms/constants/event-catalog.constant.js';
import { EventCatalog } from '../../molecules/models/event-catalog.model.js';

const MODALITIES = ['in-person', 'online', 'hybrid', 'unknown'] as const;
const MAX_ENTRIES = 300;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

const badRequest = (message: string): Error => Object.assign(new Error(message), { statusCode: 400 });

const clean = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const validDate = (value: string): boolean => value !== '' && !Number.isNaN(new Date(value).getTime());

// Valida y normaliza lo que manda el frontend; nunca se confía en el cliente.
export const sanitizeCatalog = (input: unknown): CatalogEvent[] => {
  if (!Array.isArray(input) || input.length === 0) throw badRequest('Falta la lista de eventos del calendario.');
  if (input.length > MAX_ENTRIES) throw badRequest(`El calendario excede ${MAX_ENTRIES} eventos.`);

  const bySlug = new Map<string, CatalogEvent>();
  for (const raw of input as Array<Record<string, unknown>>) {
    // El slug se valida tal como llega (sin limpiar): si trae caracteres raros se rechaza.
    const slug = typeof raw?.slug === 'string' ? raw.slug.trim().toLowerCase() : '';
    const title = clean(raw?.title, 160);
    const startDate = clean(raw?.startDate, 40);
    const endDate = clean(raw?.endDate, 40);
    if (!SLUG_RE.test(slug) || !title || !validDate(startDate) || (endDate && !validDate(endDate))) {
      throw badRequest(`Evento inválido en el calendario: "${slug || title || '?'}".`);
    }
    const modalityRaw = clean(raw?.modality, 20);
    bySlug.set(slug, {
      slug,
      title,
      startDate,
      ...(endDate ? { endDate } : {}),
      location: clean(raw?.location, 120),
      modality: (MODALITIES as readonly string[]).includes(modalityRaw)
        ? (modalityRaw as CatalogEvent['modality'])
        : 'unknown',
    });
  }
  return [...bySlug.values()];
};

// Calendario vigente: tabla `event_catalog` o, si está vacía, el archivo generado.
export const loadCatalog = async (): Promise<CatalogEvent[]> => {
  const rows = (await EventCatalog.find({ kind: 'entry' })).filter((r) => r.slug && r.title && r.startDate);
  if (rows.length === 0) return EVENT_CATALOG;
  return rows.map((r) => ({
    slug: r.slug as string,
    title: r.title as string,
    startDate: r.startDate as string,
    ...(r.endDate ? { endDate: r.endDate } : {}),
    location: r.location ?? '',
    modality: ((MODALITIES as readonly string[]).includes(r.modality ?? '') ? r.modality : 'unknown') as CatalogEvent['modality'],
  }));
};

// Espeja el calendario del frontend: agrega/actualiza por slug y quita las
// ediciones que ya no están. Solo escribe en `event_catalog`, nunca en `events`.
export const syncCatalog = async (
  input: unknown,
  adminLabel: string,
): Promise<{ count: number; added: number; updated: number; removed: number; syncedAt: string }> => {
  const entries = sanitizeCatalog(input);
  const existing = await EventCatalog.find({ kind: 'entry' });
  const bySlug = new Map(existing.map((r) => [String(r.slug), r]));
  let added = 0;
  let updated = 0;

  for (const e of entries) {
    const row = bySlug.get(e.slug);
    if (row) {
      const changed =
        row.title !== e.title ||
        row.startDate !== e.startDate ||
        (row.endDate ?? '') !== (e.endDate ?? '') ||
        (row.location ?? '') !== e.location ||
        (row.modality ?? '') !== e.modality;
      if (changed) {
        Object.assign(row, {
          title: e.title,
          startDate: e.startDate,
          endDate: e.endDate ?? '',
          location: e.location,
          modality: e.modality,
        });
        await row.save();
        updated += 1;
      }
      bySlug.delete(e.slug);
    } else {
      await EventCatalog.create({ kind: 'entry', ...e });
      added += 1;
    }
  }

  let removed = 0;
  for (const stale of bySlug.values()) {
    await EventCatalog.findByIdAndDelete(String(stale._id));
    removed += 1;
  }

  const syncedAt = new Date().toISOString();
  const meta = await EventCatalog.findOne({ kind: 'meta' });
  if (meta) {
    Object.assign(meta, { syncedAt, syncedBy: adminLabel, count: entries.length });
    await meta.save();
  } else {
    await EventCatalog.create({ kind: 'meta', syncedAt, syncedBy: adminLabel, count: entries.length });
  }
  return { count: entries.length, added, updated, removed, syncedAt };
};

export const getCatalogStatus = async (): Promise<{
  source: 'db' | 'file';
  count: number;
  syncedAt: string | null;
  syncedBy: string | null;
}> => {
  const meta = await EventCatalog.findOne({ kind: 'meta' });
  const entries = await EventCatalog.find({ kind: 'entry' });
  if (!meta || entries.length === 0) {
    return { source: 'file', count: EVENT_CATALOG.length, syncedAt: null, syncedBy: null };
  }
  return { source: 'db', count: entries.length, syncedAt: meta.syncedAt ?? null, syncedBy: meta.syncedBy ?? null };
};
