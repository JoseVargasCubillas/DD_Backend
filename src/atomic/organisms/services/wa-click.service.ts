import { WaClick, IWaClickDocument } from '../../molecules/models/wa-click.model.js';

interface RecordClickInput {
  source?: string;
  page?: string;
  message?: string;
  anonId?: string;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

const truncate = (value: string | undefined, max: number): string | undefined => {
  if (!value) return undefined;
  const clean = String(value).trim();
  if (!clean) return undefined;
  return clean.length > max ? clean.slice(0, max) : clean;
};

export const recordClick = async (input: RecordClickInput): Promise<IWaClickDocument> => {
  return WaClick.create({
    source: truncate(input.source, 64) ?? 'other',
    page: truncate(input.page, 200),
    message: truncate(input.message, 500),
    anonId: truncate(input.anonId, 64),
    referrer: truncate(input.referrer, 500),
    userAgent: truncate(input.userAgent, 500),
    ip: truncate(input.ip, 64),
    meta: input.meta ?? {},
  });
};

const isoDate = (value: Date | string): string => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export interface WaClickStats {
  total: number;
  last30d: number;
  last7d: number;
  today: number;
  uniqueVisitors: number;
  bySource: Array<{ source: string; total: number; last30d: number }>;
  byDay: Array<{ day: string; count: number }>;
  recent: Array<{
    id: string;
    source: string;
    page?: string;
    message?: string;
    anonId?: string;
    referrer?: string;
    createdAt: string;
  }>;
}

export const getStats = async (): Promise<WaClickStats> => {
  const all = await WaClick.find({});
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const bySourceMap = new Map<string, { total: number; last30d: number }>();
  const byDayMap = new Map<string, number>();
  const uniques = new Set<string>();
  let last30d = 0;
  let last7d = 0;
  let today = 0;
  const todayIso = isoDate(new Date());

  for (const click of all) {
    const created = new Date(String(click.createdAt)).getTime();
    const age = now - created;
    const source = click.source || 'other';
    const bucket = bySourceMap.get(source) ?? { total: 0, last30d: 0 };
    bucket.total += 1;
    if (age <= 30 * day) {
      bucket.last30d += 1;
      last30d += 1;
    }
    bySourceMap.set(source, bucket);
    if (age <= 7 * day) last7d += 1;
    const iso = isoDate(click.createdAt);
    if (iso === todayIso) today += 1;
    if (iso) byDayMap.set(iso, (byDayMap.get(iso) ?? 0) + 1);
    if (click.anonId) uniques.add(String(click.anonId));
  }

  const bySource = Array.from(bySourceMap.entries())
    .map(([source, v]) => ({ source, total: v.total, last30d: v.last30d }))
    .sort((a, b) => b.total - a.total);

  const byDay = Array.from(byDayMap.entries())
    .map(([d, count]) => ({ day: d, count }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  const recent = [...all]
    .sort(
      (a, b) =>
        new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
    )
    .slice(0, 50)
    .map((c) => ({
      id: String(c.id ?? ''),
      source: c.source,
      page: c.page,
      message: c.message,
      anonId: c.anonId,
      referrer: c.referrer,
      createdAt: new Date(String(c.createdAt)).toISOString(),
    }));

  return {
    total: all.length,
    last30d,
    last7d,
    today,
    uniqueVisitors: uniques.size,
    bySource,
    byDay,
    recent,
  };
};

export const listClicks = async (source?: string): Promise<IWaClickDocument[]> => {
  const filter = source ? { source } : {};
  const clicks = await WaClick.find(filter);
  return clicks.sort(
    (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
  );
};
