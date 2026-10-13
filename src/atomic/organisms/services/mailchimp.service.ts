import { env } from '../../../config/env.js';
import { splitFullName } from '../../atoms/helpers/name.helper.js';

/**
 * Campañas masivas por Mailchimp (audiencia "Diego Díaz – Estrategia Fiscal").
 * Los correos transaccionales siguen por SMTP en email.service.ts.
 *
 * Flujo de un envío:
 *  1. Subir los contactos del segmento a la audiencia (sin tocar bajas previas).
 *  2. Crear un segmento estático SOLO con esos correos.
 *  3. Crear la campaña apuntando a ese segmento y verificar que el conteo de
 *     destinatarios no exceda el del segmento (candado anti-envío masivo).
 *  4. Revisar el send-checklist y enviar.
 */

export interface MailchimpRecipient {
  name?: string;
  email: string;
  // Etiquetas de origen en Mailchimp ("dd-cliente", "dd-lead-guia-blindaje-sat"…).
  tags?: string[];
}

export interface SyncResult {
  synced: number;
  errors: Array<{ email: string; error: string }>;
}

export interface ChecklistItem {
  type: string;
  heading: string;
  details: string;
}

export interface SendCampaignResult {
  campaignId: string;
  segmentId: number;
  recipientCount: number;
  syncErrors: number;
  // Solo con dryRun: la campaña se validó pero NO se envió (y se borró).
  dryRun?: boolean;
  ready?: boolean;
  checklist?: ChecklistItem[];
}

export interface CampaignReport {
  emailsSent: number;
  opens: number;
  openRate: number;
  clicks: number;
  clickRate: number;
  unsubscribed: number;
  bounces: number;
}

export class MailchimpError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
    this.name = 'MailchimpError';
  }
}

const cfg = env.mailchimp;

const BATCH_SIZE = 500;

export const isMailchimpConfigured = (): boolean =>
  Boolean(cfg.apiKey && cfg.serverPrefix && cfg.audienceId);

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  if (!isMailchimpConfigured()) {
    throw new MailchimpError('Mailchimp no está configurado (faltan variables MAILCHIMP_* en el .env).', 503);
  }

  const res = await fetch(`https://${cfg.serverPrefix}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`dd:${cfg.apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { detail: text };
    }
  }

  if (!res.ok) {
    const reason = [json.title, json.detail].filter(Boolean).join(' — ');
    throw new MailchimpError(`Mailchimp ${res.status}: ${reason || 'error desconocido'}`, res.status);
  }
  return json as T;
};

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Etiqueta a los contactos por su origen. En Mailchimp una etiqueta es un
 * segmento estático con el mismo nombre, así que se busca o crea y se le suman
 * los correos. Es secundario: si falla, el envío continúa sin etiquetas.
 */
export const applyOriginTags = async (recipients: MailchimpRecipient[]): Promise<void> => {
  const emailsByTag = new Map<string, string[]>();
  for (const r of recipients) {
    for (const tag of r.tags ?? []) {
      const list = emailsByTag.get(tag) ?? [];
      list.push(r.email.toLowerCase());
      emailsByTag.set(tag, list);
    }
  }
  if (emailsByTag.size === 0) return;

  try {
    const existing = await request<{ segments?: Array<{ id: number; name: string }> }>(
      'GET',
      `/lists/${cfg.audienceId}/segments?type=static&count=1000&fields=segments.id,segments.name`,
    );
    const idByName = new Map((existing.segments ?? []).map((s) => [s.name, s.id]));

    for (const [tag, emails] of emailsByTag) {
      let segmentId = idByName.get(tag);
      if (segmentId === undefined) {
        const created = await request<{ id: number }>('POST', `/lists/${cfg.audienceId}/segments`, {
          name: tag,
          static_segment: [],
        });
        segmentId = created.id;
      }
      for (const group of chunk(emails, BATCH_SIZE)) {
        await request('POST', `/lists/${cfg.audienceId}/segments/${segmentId}`, { members_to_add: group });
      }
    }
  } catch (err) {
    console.warn('[mailchimp] No se pudieron aplicar las etiquetas de origen:', (err as Error).message);
  }
};

/**
 * Sube los contactos a la audiencia. `status_if_new` solo aplica a correos
 * nuevos: quien ya se dio de baja o rebotó conserva su estado y no se
 * vuelve a suscribir.
 */
export const syncMembers = async (recipients: MailchimpRecipient[]): Promise<SyncResult> => {
  const result: SyncResult = { synced: 0, errors: [] };

  for (const group of chunk(recipients, BATCH_SIZE)) {
    const response = await request<{
      total_created: number;
      total_updated: number;
      errors?: Array<{ email_address: string; error: string }>;
    }>('POST', `/lists/${cfg.audienceId}`, {
      update_existing: true,
      members: group.map((r) => ({
        email_address: r.email,
        status_if_new: 'subscribed',
        merge_fields: splitFullName(r.name),
      })),
    });

    result.synced += (response.total_created ?? 0) + (response.total_updated ?? 0);
    for (const err of response.errors ?? []) {
      result.errors.push({ email: err.email_address, error: err.error });
    }
  }

  return result;
};

/** Segmento estático con exactamente los correos indicados. */
const createStaticSegment = async (name: string, emails: string[]): Promise<number> => {
  const segment = await request<{ id: number }>('POST', `/lists/${cfg.audienceId}/segments`, {
    name,
    static_segment: [],
  });

  for (const group of chunk(emails, BATCH_SIZE)) {
    await request('POST', `/lists/${cfg.audienceId}/segments/${segment.id}`, {
      members_to_add: group,
    });
  }
  return segment.id;
};

// Mailchimp exige el link de baja y la dirección postal en HTML propio.
const withRequiredFooter = (html: string): string => {
  if (html.includes('*|UNSUB|*')) return html;
  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e0d8;font-size:12px;line-height:1.6;color:#8a8478;text-align:center;font-family:Arial,sans-serif;">
  <p style="margin:0 0 8px;">*|LIST:DESCRIPTION|*</p>
  <p style="margin:0 0 8px;">*|HTML:LIST_ADDRESS_HTML|*</p>
  <p style="margin:0;"><a href="*|UNSUB|*" style="color:#8a8478;">Cancelar suscripción</a></p>
</div>`;
  // En un documento HTML completo el pie va dentro del <body>, no después de </html>.
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, () => `${footer}</body>`);
  return `${html}${footer}`;
};

const deleteCampaignQuietly = async (campaignId: string): Promise<void> => {
  try {
    await request('DELETE', `/campaigns/${campaignId}`);
  } catch {
    // Si no se puede borrar el borrador no es crítico: nunca se envió.
  }
};

const deleteSegmentQuietly = async (segmentId: number): Promise<void> => {
  try {
    await request('DELETE', `/lists/${cfg.audienceId}/segments/${segmentId}`);
  } catch {
    // Un segmento huérfano no envía nada; solo ocupa espacio.
  }
};

const createDraftCampaign = (
  subject: string,
  listId: string,
  segmentId?: number,
): Promise<{ id: string }> =>
  request<{ id: string }>('POST', '/campaigns', {
    type: 'regular',
    recipients: {
      list_id: listId,
      // Sin segmento la campaña iría a TODA la audiencia: solo se omite a propósito.
      ...(segmentId !== undefined ? { segment_opts: { saved_segment_id: segmentId } } : {}),
    },
    settings: {
      subject_line: subject,
      title: `${subject} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      from_name: cfg.fromName,
      reply_to: cfg.replyTo,
    },
  });

/**
 * Correo de prueba: manda la campaña SOLO a los correos indicados (máx. 5).
 * Usa un segmento vacío, así que la campaña nunca puede llegar a la audiencia,
 * y borra el borrador y el segmento al terminar.
 */
export const sendTestEmail = async (params: {
  subject: string;
  html: string;
  to: string[];
}): Promise<void> => {
  const { subject, html, to } = params;
  if (to.length === 0 || to.length > 5) {
    throw new MailchimpError('Indica entre 1 y 5 correos de prueba.', 400);
  }

  const segmentId = await createStaticSegment(`dd-test-${Date.now()}`, []);
  let campaignId: string | null = null;
  try {
    // Mailchimp ya antepone "[Test]"/"[Prueba]" al asunto de los correos de prueba.
    const campaign = await createDraftCampaign(subject, cfg.audienceId, segmentId);
    campaignId = campaign.id;
    await request('PUT', `/campaigns/${campaign.id}/content`, { html: withRequiredFooter(html) });
    await request('POST', `/campaigns/${campaign.id}/actions/test`, {
      test_emails: to,
      send_type: 'html',
    });
  } finally {
    if (campaignId) await deleteCampaignQuietly(campaignId);
    await deleteSegmentQuietly(segmentId);
  }
};

/**
 * Tramo común a todo envío: candado de destinatarios, contenido, send-checklist
 * y envío. Con `dryRun` se detiene antes de enviar. Si algo falla lanza el
 * error y quien llama borra la campaña.
 */
const finalizeCampaign = async (params: {
  campaignId: string;
  html: string;
  maxRecipients: number;
  dryRun: boolean;
}): Promise<{ recipientCount: number; checklist: { is_ready: boolean; items: ChecklistItem[] } }> => {
  const { campaignId, html, maxRecipients, dryRun } = params;

  // Candado: la campaña no puede apuntar a más gente que el destino que se eligió.
  const check = await request<{ recipients?: { recipient_count?: number } }>(
    'GET',
    `/campaigns/${campaignId}?fields=recipients.recipient_count`,
  );
  const recipientCount = check.recipients?.recipient_count ?? 0;
  if (recipientCount <= 0 || recipientCount > maxRecipients) {
    throw new MailchimpError(
      `Envío cancelado por seguridad: Mailchimp reporta ${recipientCount} destinatarios y se esperaban como máximo ${maxRecipients}.`,
      409,
    );
  }

  await request('PUT', `/campaigns/${campaignId}/content`, { html: withRequiredFooter(html) });

  const checklist = await request<{ is_ready: boolean; items: ChecklistItem[] }>(
    'GET',
    `/campaigns/${campaignId}/send-checklist`,
  );
  if (dryRun) return { recipientCount, checklist };

  if (!checklist.is_ready) {
    const reasons = checklist.items
      .filter((i) => i.type === 'error')
      .map((i) => `${i.heading}: ${i.details}`)
      .join(' | ');
    throw new MailchimpError(`Mailchimp no permite enviar aún: ${reasons || 'revisa la cuenta'}`, 422);
  }

  await request('POST', `/campaigns/${campaignId}/actions/send`);
  return { recipientCount, checklist };
};

/**
 * Con `dryRun` hace todo el flujo (sube contactos, segmento, campaña, candado y
 * send-checklist) pero NO envía: borra la campaña y el segmento y devuelve el
 * resultado de la validación. Los contactos sí quedan en la audiencia, igual
 * que en un envío real.
 */
export const sendCampaign = async (params: {
  subject: string;
  html: string;
  recipients: MailchimpRecipient[];
  dryRun?: boolean;
}): Promise<SendCampaignResult> => {
  const { subject, html, recipients, dryRun = false } = params;
  if (recipients.length === 0) throw new MailchimpError('No hay destinatarios para enviar.', 400);

  const sync = await syncMembers(recipients);
  const failed = new Set(sync.errors.map((e) => e.email.toLowerCase()));
  const emails = recipients.map((r) => r.email.toLowerCase()).filter((e) => !failed.has(e));
  if (emails.length === 0) {
    throw new MailchimpError(
      `Mailchimp rechazó todos los contactos (${sync.errors[0]?.error ?? 'sin detalle'}).`,
      422,
    );
  }

  await applyOriginTags(recipients.filter((r) => !failed.has(r.email.toLowerCase())));

  const segmentId = await createStaticSegment(`dd-${Date.now()}`, emails);

  let campaign: { id: string };
  try {
    campaign = await createDraftCampaign(subject, cfg.audienceId, segmentId);
  } catch (err) {
    await deleteSegmentQuietly(segmentId);
    throw err;
  }

  try {
    // El segmento es estático y solo tiene estos correos: el conteo debe coincidir exactamente.
    const outcome = await finalizeCampaign({
      campaignId: campaign.id,
      html,
      maxRecipients: emails.length,
      dryRun,
    });

    if (dryRun) {
      await deleteCampaignQuietly(campaign.id);
      await deleteSegmentQuietly(segmentId);
      return {
        campaignId: campaign.id,
        segmentId,
        recipientCount: outcome.recipientCount,
        syncErrors: sync.errors.length,
        dryRun: true,
        ready: outcome.checklist.is_ready,
        checklist: outcome.checklist.items,
      };
    }

    return {
      campaignId: campaign.id,
      segmentId,
      recipientCount: outcome.recipientCount,
      syncErrors: sync.errors.length,
    };
  } catch (err) {
    await deleteCampaignQuietly(campaign.id);
    await deleteSegmentQuietly(segmentId);
    throw err;
  }
};

/**
 * Envía a una audiencia que ya vive en Mailchimp (o a uno de sus segmentos o
 * etiquetas), sin subir contactos de nuestra BD. `expectedCount` es el tamaño
 * que Mailchimp reportó para ese destino: si la campaña resulta apuntar a más
 * gente (p. ej. a toda la audiencia en vez de a un segmento), se cancela.
 */
export const sendToAudience = async (params: {
  subject: string;
  html: string;
  audienceId: string;
  segmentId?: number;
  expectedCount: number;
  dryRun?: boolean;
}): Promise<SendCampaignResult> => {
  const { subject, html, audienceId, segmentId, expectedCount, dryRun = false } = params;
  if (!AUDIENCE_ID_RE.test(audienceId)) throw new MailchimpError('ID de audiencia inválido.', 400);
  if (expectedCount <= 0) throw new MailchimpError('El destino no tiene contactos suscritos.', 400);

  const campaign = await createDraftCampaign(subject, audienceId, segmentId);
  try {
    // Un segmento dinámico puede variar unos contactos entre la consulta y el envío.
    const outcome = await finalizeCampaign({
      campaignId: campaign.id,
      html,
      maxRecipients: Math.ceil(expectedCount * 1.05) + 5,
      dryRun,
    });

    if (dryRun) {
      await deleteCampaignQuietly(campaign.id);
      return {
        campaignId: campaign.id,
        segmentId: segmentId ?? 0,
        recipientCount: outcome.recipientCount,
        syncErrors: 0,
        dryRun: true,
        ready: outcome.checklist.is_ready,
        checklist: outcome.checklist.items,
      };
    }

    return {
      campaignId: campaign.id,
      segmentId: segmentId ?? 0,
      recipientCount: outcome.recipientCount,
      syncErrors: 0,
    };
  } catch (err) {
    await deleteCampaignQuietly(campaign.id);
    throw err;
  }
};

const AUDIENCE_ID_RE = /^[a-z0-9]{6,20}$/i;

export interface AudienceInfo {
  id: string;
  name: string;
  // Contactos suscritos (los que realmente recibirían un envío).
  memberCount: number;
  // true para la audiencia a la que se suben los contactos de la web.
  isWebAudience: boolean;
}

export interface AudienceSegmentInfo {
  id: number;
  name: string;
  // 'static' = etiqueta; 'saved' = segmento guardado por condiciones.
  type: string;
  memberCount: number;
}

/** Audiencias de la cuenta de Mailchimp. */
export const listAudiences = async (): Promise<AudienceInfo[]> => {
  const response = await request<{
    lists?: Array<{ id: string; name: string; stats?: { member_count?: number } }>;
  }>('GET', '/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count');

  return (response.lists ?? []).map((list) => ({
    id: list.id,
    name: list.name,
    memberCount: list.stats?.member_count ?? 0,
    isWebAudience: list.id === cfg.audienceId,
  }));
};

// Segmentos temporales que crea este sistema por cada envío ("dd-<fecha>"): no son para elegir.
const SYSTEM_SEGMENT_RE = /^dd-(test-)?\d+$/;

/** Segmentos y etiquetas de una audiencia, sin los temporales del sistema. */
export const listAudienceSegments = async (audienceId: string): Promise<AudienceSegmentInfo[]> => {
  if (!AUDIENCE_ID_RE.test(audienceId)) throw new MailchimpError('ID de audiencia inválido.', 400);

  const response = await request<{
    segments?: Array<{ id: number; name: string; type: string; member_count?: number }>;
  }>(
    'GET',
    `/lists/${audienceId}/segments?count=1000&fields=segments.id,segments.name,segments.type,segments.member_count`,
  );

  return (response.segments ?? [])
    .filter((s) => (s.type === 'static' || s.type === 'saved') && !SYSTEM_SEGMENT_RE.test(s.name))
    .map((s) => ({ id: s.id, name: s.name, type: s.type, memberCount: s.member_count ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

export interface AudienceMember {
  email: string;
  name: string;
  status: string;
}

export interface AudienceMembersPage {
  members: AudienceMember[];
  // Total del destino (toda la audiencia o el segmento), no solo de esta página.
  total: number;
}

const toMember = (m: { email_address: string; full_name?: string; status?: string }): AudienceMember => ({
  email: m.email_address,
  name: m.full_name ?? '',
  status: m.status ?? 'subscribed',
});

/**
 * Contactos que recibirían un envío a una audiencia (o a uno de sus segmentos),
 * paginados. Con `query` busca un correo en toda la audiencia (máx. 10 resultados).
 */
export const listAudienceMembers = async (params: {
  audienceId: string;
  segmentId?: number;
  page: number;
  limit: number;
  query?: string;
}): Promise<AudienceMembersPage> => {
  const { audienceId, segmentId, page, limit, query } = params;
  if (!AUDIENCE_ID_RE.test(audienceId)) throw new MailchimpError('ID de audiencia inválido.', 400);
  if (segmentId !== undefined && !Number.isInteger(segmentId)) {
    throw new MailchimpError('Segmento inválido.', 400);
  }

  const q = query?.trim();
  if (q) {
    const found = await request<{
      full_search?: { members?: Array<{ email_address: string; full_name?: string; status?: string }> };
    }>(
      'GET',
      `/search-members?query=${encodeURIComponent(q)}&list_id=${audienceId}&fields=full_search.members.email_address,full_search.members.full_name,full_search.members.status`,
    );
    const members = (found.full_search?.members ?? []).map(toMember);
    return { members, total: members.length };
  }

  const offset = (page - 1) * limit;
  const base =
    segmentId !== undefined
      ? `/lists/${audienceId}/segments/${segmentId}/members`
      : `/lists/${audienceId}/members?status=subscribed&`;
  const sep = base.includes('?') ? '' : '?';
  const response = await request<{
    members?: Array<{ email_address: string; full_name?: string; status?: string }>;
    total_items?: number;
  }>(
    'GET',
    `${base}${sep}count=${limit}&offset=${offset}&fields=members.email_address,members.full_name,members.status,total_items`,
  );

  return {
    members: (response.members ?? []).map(toMember),
    total: response.total_items ?? 0,
  };
};

export const getAudienceSegment = async (
  audienceId: string,
  segmentId: number,
): Promise<AudienceSegmentInfo> => {
  if (!AUDIENCE_ID_RE.test(audienceId) || !Number.isInteger(segmentId)) {
    throw new MailchimpError('Audiencia o segmento inválido.', 400);
  }
  const s = await request<{ id: number; name: string; type: string; member_count?: number }>(
    'GET',
    `/lists/${audienceId}/segments/${segmentId}?fields=id,name,type,member_count`,
  );
  return { id: s.id, name: s.name, type: s.type, memberCount: s.member_count ?? 0 };
};

export interface CampaignDetail extends CampaignReport {
  opensTotal: number;
  clicksTotal: number;
  hardBounces: number;
  softBounces: number;
  abuseReports: number;
  sendTime: string | null;
  // Reporte de la campaña dentro de Mailchimp.
  mailchimpUrl: string | null;
}

/** Reporte completo de una campaña. Devuelve null si ya no existe en Mailchimp. */
export const getCampaignDetail = async (campaignId: string): Promise<CampaignDetail | null> => {
  try {
    const [report, campaign] = await Promise.all([
      request<{
        emails_sent?: number;
        send_time?: string;
        opens?: { unique_opens?: number; open_rate?: number; opens_total?: number };
        clicks?: { unique_subscriber_clicks?: number; click_rate?: number; clicks_total?: number };
        unsubscribed?: number;
        bounces?: { hard_bounces?: number; soft_bounces?: number };
        abuse_reports?: number;
      }>('GET', `/reports/${campaignId}`),
      request<{ web_id?: number }>('GET', `/campaigns/${campaignId}?fields=web_id`),
    ]);

    return {
      emailsSent: report.emails_sent ?? 0,
      opens: report.opens?.unique_opens ?? 0,
      openRate: report.opens?.open_rate ?? 0,
      clicks: report.clicks?.unique_subscriber_clicks ?? 0,
      clickRate: report.clicks?.click_rate ?? 0,
      unsubscribed: report.unsubscribed ?? 0,
      bounces: (report.bounces?.hard_bounces ?? 0) + (report.bounces?.soft_bounces ?? 0),
      opensTotal: report.opens?.opens_total ?? 0,
      clicksTotal: report.clicks?.clicks_total ?? 0,
      hardBounces: report.bounces?.hard_bounces ?? 0,
      softBounces: report.bounces?.soft_bounces ?? 0,
      abuseReports: report.abuse_reports ?? 0,
      sendTime: report.send_time ?? null,
      mailchimpUrl: campaign.web_id
        ? `https://${cfg.serverPrefix}.admin.mailchimp.com/reports/summary?id=${campaign.web_id}`
        : null,
    };
  } catch {
    return null;
  }
};

/** Métricas de las campañas más recientes, indexadas por id de campaña. */
export const getReports = async (): Promise<Record<string, CampaignReport>> => {
  const response = await request<{
    reports: Array<{
      id: string;
      emails_sent: number;
      opens?: { unique_opens?: number; open_rate?: number };
      clicks?: { unique_subscriber_clicks?: number; click_rate?: number };
      unsubscribed?: number;
      bounces?: { hard_bounces?: number; soft_bounces?: number };
    }>;
  }>(
    'GET',
    '/reports?count=1000&fields=reports.id,reports.emails_sent,reports.opens,reports.clicks,reports.unsubscribed,reports.bounces',
  );

  const out: Record<string, CampaignReport> = {};
  for (const r of response.reports ?? []) {
    out[r.id] = {
      emailsSent: r.emails_sent ?? 0,
      opens: r.opens?.unique_opens ?? 0,
      openRate: r.opens?.open_rate ?? 0,
      clicks: r.clicks?.unique_subscriber_clicks ?? 0,
      clickRate: r.clicks?.click_rate ?? 0,
      unsubscribed: r.unsubscribed ?? 0,
      bounces: (r.bounces?.hard_bounces ?? 0) + (r.bounces?.soft_bounces ?? 0),
    };
  }
  return out;
};
