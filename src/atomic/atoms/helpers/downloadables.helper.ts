import { Lead, ILeadDocument } from '../../molecules/models/lead.model.js';

/**
 * Catálogo de descargables que capturan leads. El `id` es lo que el admin
 * elige en la UI al armar una campaña:
 *  - fuentes simples: coincide con `leads.source`
 *  - Centro de Recursos: `centro-recursos:<resourceId>` (source 'centro-recursos'
 *    + `meta.resourceId`), porque todos los PDFs de esa página comparten source.
 */
export interface DownloadableDef {
  id: string;
  label: string;
  group: 'Home' | 'Centro de Recursos' | 'Eventos' | 'Prensa';
}

export const DOWNLOADABLES: DownloadableDef[] = [
  { id: 'guia-blindaje-sat', label: 'Guía SAT (Home)', group: 'Home' },
  { id: 'iniciativa-fiscal-2027', label: 'Iniciativa Fiscal 2027', group: 'Home' },
  { id: 'centro-recursos:ingresos-exentos-isr', label: 'Ingresos exentos de ISR', group: 'Centro de Recursos' },
  { id: 'centro-recursos:si-tu-agenda-se-ve-asi', label: 'Si tu agenda se ve así', group: 'Centro de Recursos' },
  { id: 'centro-recursos:guia-para-blindarte-del-sat', label: 'Guía para blindarte del SAT', group: 'Centro de Recursos' },
  { id: 'centro-recursos:partes-relacionadas', label: 'Partes relacionadas', group: 'Centro de Recursos' },
  { id: 'estrategia-fiscal-dossier', label: 'Dossier Estrategia Fiscal', group: 'Eventos' },
  { id: 'media-kit', label: 'Media Kit', group: 'Prensa' },
];

const CENTRO_PREFIX = 'centro-recursos:';

/** Fuentes `leads.source` que corresponden a algún descargable. */
export const DOWNLOADABLE_SOURCES = Array.from(
  new Set(DOWNLOADABLES.map((d) => (d.id.startsWith(CENTRO_PREFIX) ? 'centro-recursos' : d.id))),
);

const leadResourceId = (lead: ILeadDocument): string => {
  const meta = (lead.meta ?? {}) as Record<string, unknown>;
  return typeof meta.resourceId === 'string' ? meta.resourceId.trim() : '';
};

/** Ids de descargable que cubre un lead (uno normalmente; vacío si no es descarga). */
export const leadDownloadableIds = (lead: ILeadDocument): string[] => {
  if (lead.source === 'centro-recursos') {
    const resourceId = leadResourceId(lead);
    return resourceId ? [`${CENTRO_PREFIX}${resourceId}`] : ['centro-recursos'];
  }
  return DOWNLOADABLE_SOURCES.includes(lead.source) ? [lead.source] : [];
};

/** Normaliza lo que llega del cliente (array o "a,b,c") a ids conocidos. */
export const parseDownloadableIds = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const known = new Set(DOWNLOADABLES.map((d) => d.id));
  return Array.from(new Set(list.map((v) => String(v).trim()).filter((v) => known.has(v))));
};

/**
 * Leads que descargaron alguno de los `ids` (todos los descargables si la
 * lista viene vacía). Excluye bajas.
 */
export const findDownloadableLeads = async (ids: string[]): Promise<ILeadDocument[]> => {
  const wanted = ids.length ? new Set(ids) : null;
  const leads = await Lead.find({});
  return leads.filter((l) => {
    if (l.unsubscribed) return false;
    const mine = leadDownloadableIds(l);
    if (!mine.length) return false;
    return wanted ? mine.some((id) => wanted.has(id)) : true;
  });
};

/** Conteo de leads (sin bajas) por descargable, para la UI. */
export const countDownloadables = (leads: ILeadDocument[]): Array<DownloadableDef & { count: number }> => {
  const counts = new Map<string, Set<string>>();
  for (const l of leads) {
    if (l.unsubscribed) continue;
    const email = (l.email ?? '').trim().toLowerCase();
    if (!email) continue;
    for (const id of leadDownloadableIds(l)) {
      const set = counts.get(id) ?? new Set<string>();
      set.add(email);
      counts.set(id, set);
    }
  }
  return DOWNLOADABLES.map((d) => ({ ...d, count: counts.get(d.id)?.size ?? 0 }));
};
