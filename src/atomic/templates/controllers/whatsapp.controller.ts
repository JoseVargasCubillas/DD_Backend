import { RequestHandler } from 'express';
import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Lead } from '../../molecules/models/lead.model.js';
import {
  sendWhatsappBroadcast,
  isWhatsappBroadcastConfigured,
  type BulkRecipient,
} from '../../organisms/services/whatsapp.service.js';
import { success, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

interface Recipient {
  name: string;
  phone: string;
  email?: string;
}

// Fuentes que consideramos "leads editoriales" (recursos descargables publicos)
// — misma semantica que en email.controller para que ambos canales compartan
// segmentos y el admin no tenga que aprender dos vocabularios distintos.
const GUIDE_LEAD_SOURCES = [
  'guia-blindaje-sat',
  'media-kit',
  'estrategia-fiscal-dossier',
  'centro-recursos',
];

const dedupeByPhone = (list: Recipient[]): Recipient[] => {
  const map = new Map<string, Recipient>();
  for (const item of list) {
    const digits = (item.phone ?? '').replace(/\D/g, '');
    if (!digits) continue;
    if (!map.has(digits)) {
      map.set(digits, {
        name: item.name?.trim() || '',
        phone: digits,
        email: item.email,
      });
    }
  }
  return Array.from(map.values());
};

const fetchLeadRecipients = async (source?: string): Promise<Recipient[]> => {
  const filter = source ? { source } : {};
  const leads = await Lead.find(filter);
  return leads.map((l) => ({ name: l.name ?? '', phone: l.phone ?? '', email: l.email }));
};

const resolveTargets = async (
  segment: string,
  allUsers: IUserDocument[],
): Promise<Recipient[]> => {
  if (segment === 'guide-leads') {
    const recs: Recipient[] = [];
    for (const source of GUIDE_LEAD_SOURCES) {
      recs.push(...(await fetchLeadRecipients(source)));
    }
    return dedupeByPhone(recs);
  }
  if (segment.startsWith('lead-source:')) {
    const source = segment.slice('lead-source:'.length);
    return dedupeByPhone(await fetchLeadRecipients(source));
  }
  if (segment === 'newsletter-leads') {
    return dedupeByPhone(await fetchLeadRecipients('newsletter'));
  }

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

  return dedupeByPhone(
    userTargets.map((u) => ({
      name: u.name,
      phone: (u as { phone?: string }).phone ?? '',
      email: u.email,
    })),
  );
};

/**
 * POST /api/v1/whatsapp/broadcast
 * Body: { message, segment }
 * segment: mismos segmentos que email/broadcast; el envio real usa Whapi.
 * Solo cuentan destinatarios con telefono valido.
 */
export const sendBroadcast: RequestHandler = async (req, res) => {
  try {
    if (!isWhatsappBroadcastConfigured()) {
      return badRequest(
        res,
        'WhatsApp no esta configurado. Falta WHAPI_TOKEN en el servidor.',
      );
    }

    const { message, segment = 'subscribed' } = req.body as {
      message: string;
      segment?: string;
    };

    if (!message?.trim()) return badRequest(res, 'El mensaje es requerido.');
    if (message.length > 4000) {
      return badRequest(res, 'El mensaje excede el limite de 4000 caracteres.');
    }

    const allUsers = await User.find({ isActive: true });
    const targets = await resolveTargets(segment, allUsers);

    if (targets.length === 0) {
      return badRequest(res, 'No hay destinatarios con telefono en el segmento seleccionado.');
    }

    const bulk: BulkRecipient[] = targets.map((t) => ({ name: t.name, phone: t.phone }));
    const result = await sendWhatsappBroadcast(bulk, message);

    success(res, result);
  } catch (err) {
    serverError(res, err as Error);
  }
};

/**
 * GET /api/v1/whatsapp/contacts?segment=...
 * Muestra los destinatarios que si tienen telefono, para preview en la UI
 * antes de disparar el envio.
 */
export const getSegmentContacts: RequestHandler = async (req, res) => {
  try {
    const segment = (req.query.segment as string) || 'all';
    const allUsers = await User.find({ isActive: true }).select(
      'name email phone contactStatus marketingStatus tagIds',
    );
    const targets = await resolveTargets(segment, allUsers);
    success(res, targets);
  } catch (err) {
    serverError(res, err as Error);
  }
};

/**
 * GET /api/v1/whatsapp/segments
 * Conteos de destinatarios *con telefono* por segmento. La UI muestra ambos
 * numeros — el total del segmento (que ya calcula email/segments) y este,
 * que es lo que realmente puede recibir el mensaje.
 */
export const getSegments: RequestHandler = async (_req, res) => {
  try {
    const [allUsers, allLeads] = await Promise.all([
      User.find({ isActive: true }),
      Lead.find({}),
    ]);

    const countWithPhone = (list: Recipient[]): number => dedupeByPhone(list).length;

    const usersAsRecs = allUsers.map((u) => ({
      name: u.name,
      phone: (u as { phone?: string }).phone ?? '',
      email: u.email,
    }));
    const leadsAsRecs = allLeads.map((l) => ({
      name: l.name ?? '',
      phone: l.phone ?? '',
      email: l.email,
    }));

    const guideLeadRecs = leadsAsRecs.filter((_, idx) =>
      GUIDE_LEAD_SOURCES.includes(allLeads[idx].source),
    );
    const guiaSat = leadsAsRecs.filter((_, idx) => allLeads[idx].source === 'guia-blindaje-sat');
    const newsletterLeads = leadsAsRecs.filter(
      (_, idx) => allLeads[idx].source === 'newsletter',
    );

    const segments = {
      all: countWithPhone(usersAsRecs),
      subscribed: countWithPhone(
        usersAsRecs.filter((_, idx) => allUsers[idx].marketingStatus === 'subscribed'),
      ),
      customers: countWithPhone(
        usersAsRecs.filter((_, idx) => allUsers[idx].contactStatus === 'customer'),
      ),
      leads: countWithPhone(
        usersAsRecs.filter((_, idx) => allUsers[idx].contactStatus === 'lead'),
      ),
      guideLeads: countWithPhone(guideLeadRecs),
      newsletterLeads: countWithPhone(newsletterLeads),
      guiaSat: countWithPhone(guiaSat),
      configured: isWhatsappBroadcastConfigured(),
    };

    success(res, segments);
  } catch (err) {
    serverError(res, err as Error);
  }
};
