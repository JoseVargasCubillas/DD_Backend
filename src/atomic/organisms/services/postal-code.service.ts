import { MEXICAN_STATE_NAMES, resolveMexicanStateCode } from '../../atoms/helpers/mexican-states.helper.js';

// Consulta de codigos postales (SEPOMEX) con el servicio de geocodigos de
// Envia, el mismo que usa su panel para autollenar ciudad/estado/colonias.
// Es publico (sin token). Si no responde, la captura sigue sin esta ayuda:
// nunca debe bloquear a un asesor por una caida de este servicio.

const GEOCODES_URL = 'https://geocodes.envia.com/zipcode/MX';
const LOOKUP_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 3600 * 1000;

export interface PostalCodeInfo {
  postalCode: string;
  // Nombre canonico (el mismo de MEXICAN_STATE_NAMES / selector del front).
  state: string;
  city: string;
  colonies: string[];
}

export type PostalCodeLookup =
  | { status: 'ok'; info: PostalCodeInfo }
  | { status: 'not_found' }
  | { status: 'unavailable' };

const cache = new Map<string, { at: number; value: PostalCodeLookup }>();

// Envia usa el codigo ISO (QUE para Queretaro); el resto del sistema usa QRO.
const canonicalCode = (code: string | null | undefined): string => {
  const upper = String(code || '').toUpperCase();
  return upper === 'QUE' ? 'QRO' : upper;
};

const stateNameForCode = (code: string | null | undefined): string | null => {
  const target = canonicalCode(code);
  if (!target) return null;
  return MEXICAN_STATE_NAMES.find((name) => canonicalCode(resolveMexicanStateCode(name)) === target) ?? null;
};

export const sameState = (stateName: string, canonicalName: string): boolean => {
  const a = canonicalCode(resolveMexicanStateCode(stateName));
  const b = canonicalCode(resolveMexicanStateCode(canonicalName));
  return Boolean(a) && a === b;
};

export const lookupPostalCode = async (rawPostalCode: string): Promise<PostalCodeLookup> => {
  const postalCode = String(rawPostalCode || '').replace(/\D/g, '');
  if (!/^\d{5}$/.test(postalCode)) return { status: 'not_found' };

  const hit = cache.get(postalCode);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEOCODES_URL}/${postalCode}`, { signal: controller.signal });
    if (!res.ok) return { status: 'unavailable' };
    const payload = (await res.json()) as unknown;
    const row = Array.isArray(payload) ? (payload[0] as any) : null;

    if (!row) {
      const value: PostalCodeLookup = { status: 'not_found' };
      cache.set(postalCode, { at: Date.now(), value });
      return value;
    }

    const state = stateNameForCode(row?.state?.code?.['3digit']);
    if (!state) return { status: 'unavailable' };

    const colonies = Array.isArray(row.suburbs)
      ? (row.suburbs as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const value: PostalCodeLookup = {
      status: 'ok',
      info: { postalCode, state, city: String(row.locality || '').trim(), colonies },
    };
    cache.set(postalCode, { at: Date.now(), value });
    return value;
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
};

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Coincidencia tolerante: ignora acentos/mayusculas y acepta que uno contenga
// al otro ("Centro" vs "Centro Historico", "Col. Reforma" vs "Reforma").
export const colonyMatches = (typed: string, colonies: string[]): boolean => {
  const target = normalizeText(typed).replace(/^(col|colonia) /, '');
  if (!target) return false;
  return colonies.some((c) => {
    const candidate = normalizeText(c);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
};
