/**
 * Alta de contactos orgánicos en HubSpot.
 *
 * Todo cliente que llega solo a la página (descarga un recurso, se registra,
 * llega al checkout o compra) debe existir como contacto en HubSpot. Si ya existe
 * (mismo correo) NO se toca: los asesores pueden haberlo trabajado. Si no existe se
 * crea como "Lead nuevo" y la etiqueta de origen va en la propiedad personalizada
 * `origen_web` ("Origen web").
 *
 * Nunca debe romper el flujo que lo llama: usar siempre `syncContactToHubspot`
 * (fire-and-forget, solo registra el error en log).
 */

import { env } from '../../../config/env.js';
import { User, IUserDocument } from '../../molecules/models/user.model.js';

const API = 'https://api.hubapi.com';
const log = (msg: string): void => console.log(`[hubspot-contact] ${msg}`);

export interface HubspotContactInput {
  email: string;
  name?: string;
  phone?: string;
  /** Texto para "Detalle de la fuente del registro", p. ej. "Web · Descarga: Media Kit". */
  sourceDetail: string;
}

export type HubspotContactResult = 'created' | 'exists' | 'skipped';

const request = async (path: string, body: Record<string, unknown>): Promise<Response> => {
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.hubspot.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    return res;
  }
};

// "Detalle de la fuente del registro 1" (hs_object_source_detail_1) y la fuente
// original son de solo lectura por API, así que el origen va en una propiedad
// propia que se crea sola la primera vez (requiere crm.schemas.contacts.write;
// si no hay permiso el contacto se crea igual, sin la etiqueta).
const SOURCE_PROPERTY = 'origen_web';
let sourcePropertyReady: Promise<boolean> | null = null;

const ensureSourceProperty = (): Promise<boolean> => {
  sourcePropertyReady ??= (async () => {
    const headers = { Authorization: `Bearer ${env.hubspot.token}`, 'Content-Type': 'application/json' };
    const get = await fetch(`${API}/crm/v3/properties/contacts/${SOURCE_PROPERTY}`, { headers });
    if (get.ok) return true;
    if (get.status !== 404) {
      log(`no se pudo consultar la propiedad ${SOURCE_PROPERTY} (${get.status}) — los contactos se crean sin origen`);
      return false;
    }
    const create = await fetch(`${API}/crm/v3/properties/contacts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: SOURCE_PROPERTY,
        label: 'Origen web',
        description: 'Cómo llegó el contacto desde la página (descarga, registro, compra).',
        groupName: 'contactinformation',
        type: 'string',
        fieldType: 'text',
      }),
    });
    if (create.ok || create.status === 409) return true;
    log(`no se pudo crear la propiedad ${SOURCE_PROPERTY} (${create.status}): ${(await create.text()).slice(0, 200)} — créala a mano en HubSpot`);
    return false;
  })().then((ok) => {
    if (!ok) sourcePropertyReady = null; // reintenta más tarde
    return ok;
  });
  return sourcePropertyReady;
};

const splitName =(name?: string): { firstname?: string; lastname?: string } => {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { firstname: parts[0], ...(parts.length > 1 && { lastname: parts.slice(1).join(' ') }) };
};

export const ensureHubspotContact = async (
  input: HubspotContactInput,
  opts: { dryRun?: boolean } = {},
): Promise<HubspotContactResult> => {
  if (!env.hubspot.token || !env.hubspot.contactSyncEnabled) return 'skipped';
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) return 'skipped';

  const search = await request('/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email'],
    limit: 1,
  });
  if (!search.ok) throw new Error(`búsqueda ${search.status}: ${(await search.text()).slice(0, 200)}`);
  const found = (await search.json()) as { total?: number; results?: unknown[] };
  if ((found.results?.length ?? 0) > 0) return 'exists';

  const phone = String(input.phone ?? '').trim();
  const properties: Record<string, string> = {
    email,
    ...splitName(input.name),
    ...(phone && { phone }),
    lifecyclestage: 'lead',
    ...((await ensureSourceProperty()) && { [SOURCE_PROPERTY]: input.sourceDetail }),
  };

  if (opts.dryRun) return 'created'; // solo simula: no escribe en HubSpot
  const create = await request('/crm/v3/objects/contacts', { properties });
  if (create.status === 409) return 'exists'; // otra petición lo creó al mismo tiempo
  if (!create.ok) throw new Error(`creación ${create.status}: ${(await create.text()).slice(0, 300)}`);
  log(`contacto creado ${email} · ${input.sourceDetail}`);
  return 'created';
};

/** Fire-and-forget: nunca lanza ni bloquea al llamador. */
export const syncContactToHubspot = (input: HubspotContactInput): void => {
  ensureHubspotContact(input).catch((err) => {
    log(`no se pudo sincronizar ${input.email}: ${(err as Error).message}`);
  });
};

// ---------------------------------------------------------------------------
// Intentos de compra sin pagar: una corrida al día
// ---------------------------------------------------------------------------
// El checkout solo anota `user.hubspotPending`. Una vez al día (hora de México) se
// suben a HubSpot los usuarios que siguen como 'lead' (nunca pagaron) y cuyo primer
// intento tiene al menos HUBSPOT_ABANDONED_AFTER_HOURS. Quien pagó pasa a 'customer'
// en confirmPayment y ya no se sube. Si HubSpot falla, el pendiente queda para mañana.

const MX_TZ = 'America/Mexico_City';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface AbandonedRunSummary { checked: number; created: number; existing: number; failed: number }

export const runAbandonedCheckoutSync = async (): Promise<AbandonedRunSummary> => {
  const summary: AbandonedRunSummary = { checked: 0, created: 0, existing: 0, failed: 0 };
  if (!env.hubspot.token || !env.hubspot.contactSyncEnabled) return summary;

  const cutoff = Date.now() - env.hubspot.abandonedAfterHours * 60 * 60 * 1000;
  const users = await User.find({ contactStatus: 'lead' });
  for (const user of users) {
    const pending = user.hubspotPending;
    if (!pending || pending.syncedAt || new Date(pending.at).getTime() > cutoff) continue;
    summary.checked += 1;
    try {
      const result = await ensureHubspotContact({
        email: user.email,
        name: user.name,
        phone: user.phone,
        sourceDetail: `Web · Pago incompleto: ${pending.items.join(', ')}`.slice(0, 200),
      });
      if (result === 'skipped') continue; // sin correo válido o integración apagada: no se marca
      if (result === 'created') summary.created += 1;
      else summary.existing += 1;
      await User.findByIdAndUpdate(String(user._id), {
        hubspotPending: { ...pending, syncedAt: new Date().toISOString() },
      } as Partial<IUserDocument>);
    } catch (err) {
      summary.failed += 1;
      log(`intento abandonado ${user.email}: ${(err as Error).message}`);
    }
    await sleep(300);
  }
  return summary;
};

let abandonedWorkerStarted = false;
let lastRunDay = '';

export const startAbandonedCheckoutWorker = (): void => {
  if (abandonedWorkerStarted) return;
  if (!env.hubspot.token || !env.hubspot.contactSyncEnabled) {
    log('worker de intentos abandonados desactivado (sin HUBSPOT_TOKEN o HUBSPOT_CONTACT_SYNC_ENABLED=false)');
    return;
  }
  abandonedWorkerStarted = true;
  const tick = async (): Promise<void> => {
    const now = new Date();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ }).format(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: MX_TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (day === lastRunDay || hour < env.hubspot.abandonedRunHour) return;
    lastRunDay = day;
    try {
      const s = await runAbandonedCheckoutSync();
      log(`corrida diaria: ${s.checked} intentos · ${s.created} creados · ${s.existing} ya existían · ${s.failed} con error`);
    } catch (err) {
      lastRunDay = ''; // reintenta en la siguiente revisión
      log(`corrida diaria falló: ${(err as Error).message}`);
    }
  };
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), 30 * 60 * 1000);
  log(`worker de intentos abandonados iniciado (1 vez al día a las ${env.hubspot.abandonedRunHour}:00 hora de México)`);
};
