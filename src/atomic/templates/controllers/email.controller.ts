import { timingSafeEqual } from 'node:crypto';
import { RequestHandler } from 'express';
import { env } from '../../../config/env.js';
import { verifyMailchimpSignature } from '../../atoms/helpers/mailchimp-signature.helper.js';
import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Lead } from '../../molecules/models/lead.model.js';
import { EmailCampaign } from '../../molecules/models/email-campaign.model.js';
import * as mailchimp from '../../organisms/services/mailchimp.service.js';
import {
  findActiveSending,
  runCampaignInBackground,
} from '../../organisms/services/email-campaign.service.js';
import { getQueueStatus } from '../../organisms/services/email-queue.service.js';
import { success, badRequest, forbidden, notFound, serverError } from '../../atoms/helpers/response.helper.js';

interface Recipient {
  name: string;
  email: string;
  // Etiquetas de origen que se aplican en Mailchimp ("dd-cliente", "dd-lead-newsletter"…).
  tags?: string[];
}

// Etiquetas de Mailchimp según de dónde viene el contacto.
const userOriginTags = (u: IUserDocument): string[] => {
  const tags = ['dd-usuario'];
  if (u.contactStatus === 'customer') tags.push('dd-cliente');
  else if (u.contactStatus === 'churned') tags.push('dd-ex-cliente');
  else tags.push('dd-lead-usuario');
  if (u.marketingStatus === 'subscribed') tags.push('dd-academia');
  return tags;
};

const leadOriginTags = (source?: string): string[] => [`dd-lead-${source || 'other'}`];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CUSTOM_RECIPIENTS = 500;

// Fuentes que consideramos "leads editoriales" (recursos descargables públicos)
const GUIDE_LEAD_SOURCES = [
  'guia-blindaje-sat',
  'iniciativa-fiscal-2027',
  'media-kit',
  'estrategia-fiscal-dossier',
  'centro-recursos',
];

// Un mismo correo puede venir de varias fuentes: se unen sus etiquetas y se
// conserva el primer nombre no vacío.
const dedupeByEmail = (list: Recipient[]): Recipient[] => {
  const map = new Map<string, Recipient>();
  for (const item of list) {
    const key = (item.email ?? '').trim().toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { name: item.name?.trim() || '', email: key, tags: [...(item.tags ?? [])] });
      continue;
    }
    if (!existing.name && item.name?.trim()) existing.name = item.name.trim();
    existing.tags = Array.from(new Set([...(existing.tags ?? []), ...(item.tags ?? [])]));
  }
  return Array.from(map.values());
};

const fetchLeadRecipients = async (source?: string): Promise<Recipient[]> => {
  const filter = source ? { source } : {};
  const leads = await Lead.find(filter);
  return leads
    .filter((l) => !l.unsubscribed)
    .map((l) => ({ name: l.name ?? '', email: l.email, tags: leadOriginTags(l.source) }));
};

const resolveTargets = async (
  segment: string,
  allUsers: IUserDocument[],
): Promise<Recipient[]> => {
  // Segmentos basados en tabla `leads`
  if (segment === 'guide-leads') {
    const recs: Recipient[] = [];
    for (const source of GUIDE_LEAD_SOURCES) {
      recs.push(...(await fetchLeadRecipients(source)));
    }
    return dedupeByEmail(recs);
  }
  if (segment.startsWith('lead-source:')) {
    const source = segment.slice('lead-source:'.length);
    return dedupeByEmail(await fetchLeadRecipients(source));
  }
  if (segment === 'newsletter-leads') {
    return dedupeByEmail(await fetchLeadRecipients('newsletter'));
  }

  // Segmentos basados en tabla `users` (quien se dio de baja nunca recibe campañas)
  let userTargets = allUsers.filter((u) => u.marketingStatus !== 'unsubscribed');
  if (segment === 'subscribed') {
    userTargets = userTargets.filter((u) => u.marketingStatus === 'subscribed');
  } else if (segment === 'customers') {
    userTargets = userTargets.filter((u) => u.contactStatus === 'customer');
  } else if (segment === 'leads') {
    userTargets = userTargets.filter((u) => u.contactStatus === 'lead');
  } else if (segment !== 'all') {
    userTargets = userTargets.filter((u) => u.tagIds?.includes(segment));
  }
  return dedupeByEmail(
    userTargets.map((u) => ({ name: u.name, email: u.email, tags: userOriginTags(u) })),
  );
};

/**
 * Segmento 'custom': correos pegados a mano por el admin. Se normalizan,
 * deduplican y se descartan los que ya se dieron de baja. Si el correo existe
 * en nuestra BD se reutiliza su nombre para personalizar (*|FNAME|*).
 */
const resolveCustomTargets = async (
  rawEmails: unknown,
): Promise<{ targets: Recipient[]; invalid: string[]; excluded: number }> => {
  const invalid: string[] = [];
  const seen = new Set<string>();
  const valid: string[] = [];

  for (const raw of Array.isArray(rawEmails) ? rawEmails : []) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      invalid.push(email);
      continue;
    }
    if (!seen.has(email)) {
      seen.add(email);
      valid.push(email);
    }
  }

  const [users, leads] = await Promise.all([User.find({}), Lead.find({})]);
  const unsubscribed = new Set<string>();
  const names = new Map<string, string>();
  const originTags = new Map<string, Set<string>>();
  const addTags = (key: string, tags: string[]) => {
    const set = originTags.get(key) ?? new Set<string>();
    tags.forEach((t) => set.add(t));
    originTags.set(key, set);
  };
  for (const u of users) {
    const key = (u.email ?? '').trim().toLowerCase();
    if (u.marketingStatus === 'unsubscribed') unsubscribed.add(key);
    if (u.name) names.set(key, u.name);
    addTags(key, userOriginTags(u));
  }
  for (const l of leads) {
    const key = (l.email ?? '').trim().toLowerCase();
    if (l.unsubscribed) unsubscribed.add(key);
    if (l.name && !names.has(key)) names.set(key, l.name);
    addTags(key, leadOriginTags(l.source));
  }

  const targets = valid
    .filter((email) => !unsubscribed.has(email))
    .map((email) => ({
      name: names.get(email) ?? '',
      email,
      // Correos que no existen en tu base: se marcan como carga manual.
      tags: originTags.has(email) ? Array.from(originTags.get(email)!) : ['dd-manual'],
    }));

  return { targets, invalid, excluded: valid.length - targets.length };
};

// Frase que el admin debe escribir para confirmar un envío masivo. También la exige el servidor.
const MASS_CONFIRMATION_PHRASE = 'ENVIAR A TODOS';
// Un envío a un segmento de Mailchimp por encima de este tamaño también exige la frase.
const MASS_THRESHOLD = 1000;

interface BroadcastBody {
  subject?: string;
  html?: string;
  // 'web': contactos de tu BD. 'mailchimp': una audiencia (o segmento) que ya vive en Mailchimp.
  source?: 'web' | 'mailchimp';
  segment?: string;
  segmentLabel?: string;
  // Solo con segment === 'custom'.
  emails?: string[];
  // Solo con source === 'mailchimp'. Sin `audienceSegmentId` es TODA la audiencia.
  audienceId?: string;
  audienceSegmentId?: number | string | null;
  dryRun?: boolean;
  confirmation?: string;
}

// Qué se va a enviar y cómo. Se arma antes de enviar para validarlo y mostrarlo en el historial.
interface SendPlan {
  label: string;
  segmentKey: string;
  source: 'web' | 'mailchimp';
  audienceId?: string;
  audienceName?: string;
  totalTargets: number;
  excluded: number;
  // El envío es masivo: el servidor exige la frase de confirmación.
  needsConfirmation: boolean;
  run: (dryRun: boolean) => Promise<mailchimp.SendCampaignResult>;
}

const planWebSend = async (
  body: BroadcastBody,
  subject: string,
  html: string,
): Promise<SendPlan | { error: string }> => {
  const segment = body.segment ?? 'subscribed';
  let targets: Recipient[];
  let excluded = 0;
  let label = body.segmentLabel ?? segment;

  if (segment === 'custom') {
    const custom = await resolveCustomTargets(body.emails);
    if (custom.invalid.length > 0) {
      return {
        error: `Hay correos con formato inválido: ${custom.invalid.slice(0, 5).join(', ')}${custom.invalid.length > 5 ? '…' : ''}`,
      };
    }
    if (custom.targets.length > MAX_CUSTOM_RECIPIENTS) {
      return { error: `Máximo ${MAX_CUSTOM_RECIPIENTS} destinatarios personalizados por envío.` };
    }
    targets = custom.targets;
    excluded = custom.excluded;
    label = `Personalizado (${targets.length})`;
  } else {
    const allUsers = await User.find({ isActive: true });
    targets = await resolveTargets(segment, allUsers);
  }

  if (targets.length === 0) {
    return {
      error:
        segment === 'custom'
          ? 'No hay destinatarios válidos (los dados de baja se excluyen automáticamente).'
          : 'No hay destinatarios en el segmento seleccionado.',
    };
  }

  return {
    label,
    segmentKey: segment,
    source: 'web',
    totalTargets: targets.length,
    excluded,
    needsConfirmation: segment === 'all',
    run: (dryRun) => mailchimp.sendCampaign({ subject, html, recipients: targets, dryRun }),
  };
};

const planAudienceSend = async (
  body: BroadcastBody,
  subject: string,
  html: string,
): Promise<SendPlan | { error: string }> => {
  const audienceId = String(body.audienceId ?? '').trim();
  if (!audienceId) return { error: 'Elige la audiencia de Mailchimp.' };

  const rawSegment = body.audienceSegmentId;
  const hasSegment = rawSegment !== undefined && rawSegment !== null && rawSegment !== '';
  const segmentId = hasSegment ? Number(rawSegment) : undefined;
  if (hasSegment && !Number.isInteger(segmentId)) return { error: 'Segmento de Mailchimp inválido.' };

  const audience = (await mailchimp.listAudiences()).find((a) => a.id === audienceId);
  if (!audience) return { error: 'La audiencia no existe en tu cuenta de Mailchimp.' };

  let expectedCount = audience.memberCount;
  let segmentName = 'Toda la audiencia';
  if (segmentId !== undefined) {
    const segment = await mailchimp.getAudienceSegment(audienceId, segmentId);
    expectedCount = segment.memberCount;
    segmentName = segment.name;
  }
  if (expectedCount <= 0) return { error: 'Ese destino no tiene contactos suscritos.' };

  return {
    label: `${audience.name} · ${segmentName}`,
    segmentKey: `mailchimp:${audienceId}${segmentId !== undefined ? `:${segmentId}` : ''}`,
    source: 'mailchimp',
    audienceId,
    audienceName: audience.name,
    totalTargets: expectedCount,
    excluded: 0,
    // Toda la audiencia, o un segmento muy grande.
    needsConfirmation: segmentId === undefined || expectedCount > MASS_THRESHOLD,
    run: (dryRun) =>
      mailchimp.sendToAudience({ subject, html, audienceId, segmentId, expectedCount, dryRun }),
  };
};

/**
 * POST /api/v1/email/broadcast
 * Body: { subject, html, source?, segment?, emails?, audienceId?, audienceSegmentId?, dryRun?, confirmation? }
 *
 * source 'web' (por defecto): segmento de tu BD (ver resolveTargets).
 * source 'mailchimp': una audiencia de Mailchimp, entera o uno de sus segmentos.
 *
 * Un envío real responde 202 al instante y se ejecuta en segundo plano: el
 * resultado queda en el historial (status 'sending' -> 'sent' | 'failed').
 * `dryRun` valida todo y responde en la misma petición, sin enviar.
 */
export const sendBroadcast: RequestHandler = async (req, res) => {
  try {
    const body = req.body as BroadcastBody;
    const subject = body.subject?.trim() ?? '';
    const html = body.html ?? '';
    const dryRun = body.dryRun === true;

    if (!subject) return badRequest(res, 'El asunto es requerido.');
    if (!html.trim()) return badRequest(res, 'El contenido es requerido.');
    if (!mailchimp.isMailchimpConfigured()) {
      return badRequest(res, 'Mailchimp no está configurado en el servidor.');
    }

    let plan: SendPlan | { error: string };
    try {
      plan =
        body.source === 'mailchimp'
          ? await planAudienceSend(body, subject, html)
          : await planWebSend(body, subject, html);
    } catch (err) {
      if (err instanceof mailchimp.MailchimpError) return badRequest(res, err.message);
      throw err;
    }
    if ('error' in plan) return badRequest(res, plan.error);

    // Validar no envía nada, así que no pide confirmación.
    if (dryRun) {
      let result: mailchimp.SendCampaignResult;
      try {
        result = await plan.run(true);
      } catch (err) {
        if (err instanceof mailchimp.MailchimpError) return badRequest(res, err.message);
        throw err;
      }
      return success(res, {
        dryRun: true,
        ready: result.ready ?? false,
        checklist: result.checklist ?? [],
        sent: 0,
        failed: result.syncErrors,
        total: plan.totalTargets,
        excluded: plan.excluded,
        recipientCount: result.recipientCount,
      });
    }

    if (plan.needsConfirmation && body.confirmation?.trim() !== MASS_CONFIRMATION_PHRASE) {
      return badRequest(res, `Este es un envío masivo. Escribe "${MASS_CONFIRMATION_PHRASE}" para confirmar.`);
    }

    if (await findActiveSending()) {
      return res
        .status(409)
        .json({ success: false, message: 'Ya hay un envío en curso. Espera a que termine para lanzar otro.' });
    }

    const campaign = await EmailCampaign.create({
      subject,
      html,
      segment: plan.segmentKey,
      segmentLabel: plan.label,
      status: 'sending',
      source: plan.source,
      audienceId: plan.audienceId,
      audienceName: plan.audienceName,
      totalTargets: plan.totalTargets,
      recipientCount: 0,
      mailchimpCampaignId: '',
      mailchimpSegmentId: 0,
      syncErrors: 0,
      sentBy: (req as any).user?._id,
      sentAt: new Date().toISOString(),
    });

    runCampaignInBackground(campaign._id, () => plan.run(false));

    res.status(202).json({
      success: true,
      data: {
        id: campaign._id,
        status: 'sending',
        total: plan.totalTargets,
        excluded: plan.excluded,
      },
    });
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/audiences
 * Audiencias de la cuenta de Mailchimp (para elegir el destino de un envío).
 */
export const getAudiences: RequestHandler = async (_req, res) => {
  try {
    if (!mailchimp.isMailchimpConfigured()) return badRequest(res, 'Mailchimp no está configurado en el servidor.');
    success(res, await mailchimp.listAudiences());
  } catch (err: any) {
    if (err instanceof mailchimp.MailchimpError) return badRequest(res, err.message);
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/audiences/:audienceId/segments
 * Segmentos y etiquetas de una audiencia de Mailchimp.
 */
export const getAudienceSegments: RequestHandler = async (req, res) => {
  try {
    if (!mailchimp.isMailchimpConfigured()) return badRequest(res, 'Mailchimp no está configurado en el servidor.');
    success(res, await mailchimp.listAudienceSegments(String(req.params.audienceId)));
  } catch (err: any) {
    if (err instanceof mailchimp.MailchimpError) return badRequest(res, err.message);
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/audiences/:audienceId/members?segmentId&page&limit&q
 * Contactos de una audiencia de Mailchimp (o de uno de sus segmentos), paginados,
 * para ver a quién llegaría un envío. `q` busca un correo en toda la audiencia.
 */
export const getAudienceMembers: RequestHandler = async (req, res) => {
  try {
    if (!mailchimp.isMailchimpConfigured()) return badRequest(res, 'Mailchimp no está configurado en el servidor.');

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rawSegment = req.query.segmentId;
    const segmentId = rawSegment !== undefined && rawSegment !== '' ? Number(rawSegment) : undefined;

    const result = await mailchimp.listAudienceMembers({
      audienceId: String(req.params.audienceId),
      segmentId,
      page,
      limit,
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
    });

    success(res, { ...result, page, pages: Math.max(1, Math.ceil(result.total / limit)) });
  } catch (err: any) {
    if (err instanceof mailchimp.MailchimpError) return badRequest(res, err.message);
    serverError(res, err);
  }
};

/**
 * POST /api/v1/email/test
 * Body: { subject, html, to?: string[] }
 * Manda la campaña como correo de prueba solo a `to` (máx. 5). Si no se indica,
 * va al correo del admin que está conectado. No toca a ningún contacto.
 */
export const sendTestCampaign: RequestHandler = async (req, res) => {
  try {
    const { subject, html, to } = req.body as { subject?: string; html?: string; to?: string[] };

    if (!subject?.trim()) return badRequest(res, 'El asunto es requerido.');
    if (!html?.trim()) return badRequest(res, 'El contenido es requerido.');
    if (!mailchimp.isMailchimpConfigured()) {
      return badRequest(res, 'Mailchimp no está configurado en el servidor.');
    }

    const adminEmail = (req as any).user?.email as string | undefined;
    const recipients = Array.from(
      new Set((Array.isArray(to) && to.length ? to : [adminEmail ?? '']).map((e) => String(e).trim().toLowerCase())),
    ).filter(Boolean);

    if (recipients.length === 0 || recipients.length > 5) {
      return badRequest(res, 'Indica entre 1 y 5 correos de prueba.');
    }
    const invalid = recipients.find((e) => !EMAIL_RE.test(e));
    if (invalid) return badRequest(res, `Correo de prueba inválido: ${invalid}`);

    try {
      await mailchimp.sendTestEmail({ subject: subject.trim(), html, to: recipients });
    } catch (err) {
      if (err instanceof mailchimp.MailchimpError) return badRequest(res, err.message);
      throw err;
    }

    success(res, { sentTo: recipients });
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/campaigns
 * Historial de campañas con métricas de Mailchimp (aperturas, clics, bajas).
 */
export const getCampaigns: RequestHandler = async (_req, res) => {
  try {
    const campaigns = await EmailCampaign.find({}).sort({ sentAt: -1 }).limit(50);

    let reports: Record<string, mailchimp.CampaignReport> = {};
    if (mailchimp.isMailchimpConfigured()) {
      try {
        reports = await mailchimp.getReports();
      } catch {
        // Sin métricas el historial igual se muestra.
      }
    }

    success(
      res,
      campaigns.map((c) => ({
        id: c._id,
        subject: c.subject,
        segment: c.segmentLabel ?? c.segment,
        totalTargets: c.totalTargets,
        recipientCount: c.recipientCount,
        sentAt: c.sentAt,
        // Las campañas anteriores al envío en segundo plano no traen estado: ya se enviaron.
        status: c.status ?? 'sent',
        error: c.error || null,
        report: reports[c.mailchimpCampaignId] ?? null,
      })),
    );
  } catch (err: any) {
    serverError(res, err);
  }
};

const parseDate = (value: unknown, endOfDay = false): Date | null => {
  if (!value) return null;
  const date = new Date(`${String(value)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * GET /api/v1/email/campaigns/history?page&limit&q&segment&from&to
 * Historial paginado y filtrable. `from`/`to` son fechas YYYY-MM-DD.
 */
export const getCampaignHistory: RequestHandler = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const segment = String(req.query.segment ?? '').trim();
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);

    const all = await EmailCampaign.find({}).sort({ sentAt: -1 });
    const segments = Array.from(new Set(all.map((c) => c.segmentLabel ?? c.segment))).sort();

    const filtered = all.filter((c) => {
      if (q && !c.subject.toLowerCase().includes(q)) return false;
      if (segment && (c.segmentLabel ?? c.segment) !== segment) return false;
      const sent = new Date(c.sentAt);
      if (from && sent < from) return false;
      if (to && sent > to) return false;
      return true;
    });

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const slice = filtered.slice((page - 1) * limit, page * limit);

    let reports: Record<string, mailchimp.CampaignReport> = {};
    if (mailchimp.isMailchimpConfigured() && slice.length > 0) {
      try {
        reports = await mailchimp.getReports();
      } catch {
        // Sin métricas el historial igual se muestra.
      }
    }

    const senderIds = Array.from(new Set(slice.map((c) => c.sentBy).filter(Boolean))) as string[];
    const senders = senderIds.length ? await User.find({ _id: { $in: senderIds } }) : [];
    const senderName = new Map(senders.map((u) => [String(u._id), u.name]));

    success(res, {
      items: slice.map((c) => ({
        id: c._id,
        subject: c.subject,
        segment: c.segmentLabel ?? c.segment,
        totalTargets: c.totalTargets,
        recipientCount: c.recipientCount,
        sentAt: c.sentAt,
        sentByName: c.sentBy ? senderName.get(String(c.sentBy)) ?? null : null,
        status: c.status ?? 'sent',
        error: c.error || null,
        hasHtml: Boolean(c.html),
        report: reports[c.mailchimpCampaignId] ?? null,
      })),
      total,
      page,
      pages,
      segments,
    });
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/campaigns/:id
 * Detalle: datos guardados, HTML enviado (si existe) y reporte completo de Mailchimp.
 */
export const getCampaignById: RequestHandler = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(String(req.params.id));
    if (!campaign) return notFound(res, 'Campaña no encontrada');

    const [detail, sender] = await Promise.all([
      // Una campaña aún en proceso o fallida no tiene reporte en Mailchimp.
      mailchimp.isMailchimpConfigured() && campaign.mailchimpCampaignId
        ? mailchimp.getCampaignDetail(campaign.mailchimpCampaignId)
        : Promise.resolve(null),
      campaign.sentBy ? User.findById(String(campaign.sentBy)) : Promise.resolve(null),
    ]);

    success(res, {
      id: campaign._id,
      subject: campaign.subject,
      html: campaign.html ?? null,
      segment: campaign.segmentLabel ?? campaign.segment,
      segmentId: campaign.segment,
      status: campaign.status ?? 'sent',
      error: campaign.error || null,
      totalTargets: campaign.totalTargets,
      recipientCount: campaign.recipientCount,
      syncErrors: campaign.syncErrors,
      sentAt: campaign.sentAt,
      sentByName: sender?.name ?? null,
      detail,
    });
  } catch (err: any) {
    serverError(res, err);
  }
};

const secretMatches = (provided: unknown): boolean => {
  const expected = env.mailchimp.webhookSecret;
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * GET|POST /api/v1/email/webhooks/mailchimp?secret=...
 * Público (sin JWT) pero protegido con secreto en la URL. Mailchimp lo llama
 * con GET para validar la URL y con POST (form-urlencoded) en cada evento.
 * Las bajas y correos "cleaned" se marcan para excluirlos de los segmentos.
 */
export const mailchimpWebhook: RequestHandler = async (req, res) => {
  try {
    if (!secretMatches(req.query.secret)) return forbidden(res, 'Forbidden');
    // Mailchimp valida la URL con un GET (sin firma) al crear el webhook.
    if (req.method === 'GET') return success(res, { ok: true });

    // Segunda capa (opcional): firma HMAC de Mailchimp sobre el cuerpo crudo.
    const signingSecret = env.mailchimp.webhookSigningSecret;
    if (
      signingSecret &&
      !verifyMailchimpSignature((req as any).rawBody, req.get('x-mailchimp-signature'), signingSecret)
    ) {
      console.warn('[mailchimp-webhook] Aviso rechazado: firma ausente, inválida o vencida.');
      return forbidden(res, 'Forbidden');
    }

    const { type, data } = (req.body ?? {}) as { type?: string; data?: { email?: string } };
    const email = data?.email?.trim().toLowerCase();

    if ((type === 'unsubscribe' || type === 'cleaned') && email) {
      const users = await User.find({ email });
      for (const user of users) {
        user.marketingStatus = 'unsubscribed';
        await user.save();
      }
      const leads = await Lead.find({ email });
      for (const lead of leads) {
        lead.unsubscribed = true;
        await lead.save();
      }
    }

    success(res, { ok: true });
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/contacts?segment=...
 * Retorna la lista de contactos del segmento para previsualización en la UI.
 */
export const getSegmentContacts: RequestHandler = async (req, res) => {
  try {
    const segment = (req.query.segment as string) || 'all';
    const allUsers = await User.find({ isActive: true }).select(
      'name email contactStatus marketingStatus tagIds',
    );

    const targets = await resolveTargets(segment, allUsers);
    success(res, targets);
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/queue-status
 */
export const getMigrationQueueStatus: RequestHandler = async (_req, res) => {
  try {
    const status = await getQueueStatus('migration_welcome');
    success(res, status);
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/segments
 * Retorna conteos por segmento para mostrar en la UI.
 */
export const getSegments: RequestHandler = async (_req, res) => {
  try {
    const [activeUsers, allLeads] = await Promise.all([
      User.find({ isActive: true }),
      Lead.find({}),
    ]);
    // Las bajas no cuentan como destinatarios posibles.
    const allUsers = activeUsers.filter((u) => u.marketingStatus !== 'unsubscribed');

    const guideLeadRecipients = dedupeByEmail(
      allLeads
        .filter((l) => GUIDE_LEAD_SOURCES.includes(l.source) && !l.unsubscribed)
        .map((l) => ({ name: l.name ?? '', email: l.email })),
    );

    const guiaSat = allLeads.filter((l) => l.source === 'guia-blindaje-sat').length;
    const iniciativaFiscal2027 = allLeads.filter((l) => l.source === 'iniciativa-fiscal-2027').length;
    const newsletterLeads = allLeads.filter((l) => l.source === 'newsletter').length;

    const segments = {
      all: allUsers.length,
      subscribed: allUsers.filter((u) => u.marketingStatus === 'subscribed').length,
      customers: allUsers.filter((u) => u.contactStatus === 'customer').length,
      leads: allUsers.filter((u) => u.contactStatus === 'lead').length,
      guideLeads: guideLeadRecipients.length,
      newsletterLeads,
      guiaSat,
      iniciativaFiscal2027,
    };

    success(res, segments);
  } catch (err: any) {
    serverError(res, err);
  }
};
