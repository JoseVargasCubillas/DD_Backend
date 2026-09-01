import { RequestHandler } from 'express';
import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Lead } from '../../molecules/models/lead.model.js';
import * as emailService from '../../organisms/services/email.service.js';
import { getQueueStatus } from '../../organisms/services/email-queue.service.js';
import { success, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

interface Recipient {
  name: string;
  email: string;
}

// Fuentes que consideramos "leads editoriales" (recursos descargables públicos)
const GUIDE_LEAD_SOURCES = [
  'guia-blindaje-sat',
  'media-kit',
  'estrategia-fiscal-dossier',
  'centro-recursos',
];

const dedupeByEmail = (list: Recipient[]): Recipient[] => {
  const map = new Map<string, Recipient>();
  for (const item of list) {
    const key = (item.email ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, { name: item.name?.trim() || '', email: key });
  }
  return Array.from(map.values());
};

const fetchLeadRecipients = async (source?: string): Promise<Recipient[]> => {
  const filter = source ? { source } : {};
  const leads = await Lead.find(filter);
  return leads.map((l) => ({ name: l.name ?? '', email: l.email }));
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

  // Segmentos basados en tabla `users`
  let userTargets = allUsers;
  if (segment === 'subscribed') {
    userTargets = allUsers.filter((u) => u.marketingStatus === 'subscribed');
  } else if (segment === 'customers') {
    userTargets = allUsers.filter((u) => u.contactStatus === 'customer');
  } else if (segment === 'leads') {
    userTargets = allUsers.filter((u) => u.contactStatus === 'lead');
  } else if (segment !== 'all') {
    userTargets = allUsers.filter((u) => u.tagIds?.includes(segment));
  }
  return dedupeByEmail(userTargets.map((u) => ({ name: u.name, email: u.email })));
};

/**
 * POST /api/v1/email/broadcast
 * Body: { subject, html, segment }
 * segment: 'all' | 'subscribed' | 'customers' | 'leads' | 'guide-leads'
 *        | 'lead-source:<source>' | tagId (string)
 */
export const sendBroadcast: RequestHandler = async (req, res) => {
  try {
    const { subject, html, segment = 'subscribed' } = req.body as {
      subject: string;
      html: string;
      segment?: string;
    };

    if (!subject?.trim()) return badRequest(res, 'El asunto es requerido.');
    if (!html?.trim()) return badRequest(res, 'El contenido es requerido.');

    const allUsers = await User.find({ isActive: true });
    const targets = await resolveTargets(segment, allUsers);

    if (targets.length === 0) {
      return badRequest(res, 'No hay destinatarios en el segmento seleccionado.');
    }

    // Enviar en lotes de 50 para no saturar el servidor SMTP
    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((recipient) =>
          (emailService as any).send
            ? (emailService as any).send(recipient.email, subject, html)
            : Promise.resolve(),
        ),
      ).then((results) => {
        results.forEach((r) => {
          if (r.status === 'fulfilled') sent++;
          else failed++;
        });
      });
    }

    success(res, { sent, failed, total: targets.length });
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
    const [allUsers, allLeads] = await Promise.all([
      User.find({ isActive: true }),
      Lead.find({}),
    ]);

    const guideLeadRecipients = dedupeByEmail(
      allLeads
        .filter((l) => GUIDE_LEAD_SOURCES.includes(l.source))
        .map((l) => ({ name: l.name ?? '', email: l.email })),
    );

    const guiaSat = allLeads.filter((l) => l.source === 'guia-blindaje-sat').length;
    const newsletterLeads = allLeads.filter((l) => l.source === 'newsletter').length;

    const segments = {
      all: allUsers.length,
      subscribed: allUsers.filter((u) => u.marketingStatus === 'subscribed').length,
      customers: allUsers.filter((u) => u.contactStatus === 'customer').length,
      leads: allUsers.filter((u) => u.contactStatus === 'lead').length,
      guideLeads: guideLeadRecipients.length,
      newsletterLeads,
      guiaSat,
    };

    success(res, segments);
  } catch (err: any) {
    serverError(res, err);
  }
};
