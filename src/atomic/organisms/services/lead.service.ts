import path from 'node:path';
import fs from 'node:fs';
import { Lead, ILeadDocument, LeadSource } from '../../molecules/models/lead.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Tag } from '../../molecules/models/tag.model.js';
import { isAllowedOrigin } from '../../../config/allowed-origins.js';
import {
  sendDownloadableResourceEmail,
  sendEstrategiaFiscalDossierEmail,
  sendGuideEmail,
  sendMediaKitEmail,
} from './email.service.js';

// Guías se almacenan en <project-root>/assets. Backend arranca desde su raíz.
const GUIDE_PATH = path.resolve(process.cwd(), 'assets', 'guia-blindaje-sat.pdf');
const GUIDE_FILENAME = 'Guia-Blindaje-SAT-Diego-Diaz.pdf';
const ESTRATEGIA_FISCAL_DOSSIER_PATH = path.resolve(
  process.cwd(),
  'assets',
  'seminario-estrategia-fiscal-dossier.pdf',
);
const ESTRATEGIA_FISCAL_DOSSIER_FILENAME = 'Seminario-Estrategia-Fiscal-Diego-Diaz.pdf';
const MEDIA_KIT_URL =
  process.env.MEDIA_KIT_URL ||
  'https://github.com/JoseVargasCubillas/DD_Frontend/releases/download/media-v1/DDMedia-Kit.pdf';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const isAllowedResourceUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return isAllowedOrigin(url.origin);
  } catch {
    return false;
  }
};

const findByEmailAndSource = async (
  email: string,
  source: LeadSource,
): Promise<ILeadDocument | null> => {
  const existing = await Lead.find({ email, source });
  return existing[0] ?? null;
};

export const captureLead = async (input: {
  email: string;
  source: LeadSource;
  name?: string;
  phone?: string;
  meta?: Record<string, unknown>;
}): Promise<ILeadDocument> => {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) {
    const err: any = new Error('El correo no es válido.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await findByEmailAndSource(email, input.source);
  if (existing) {
    if (input.name) existing.name = input.name;
    if (input.phone) existing.phone = input.phone;
    if (input.meta) existing.meta = { ...(existing.meta ?? {}), ...input.meta };
    return existing.save();
  }

  return Lead.create({
    email,
    source: input.source,
    name: input.name,
    phone: input.phone,
    meta: input.meta ?? {},
  });
};

export const sendSatGuide = async (input: {
  email: string;
  name?: string;
  phone?: string;
}): Promise<ILeadDocument> => {
  const phone = input.phone?.trim();
  if (!phone) {
    const err: any = new Error('El número de teléfono es requerido.');
    err.statusCode = 400;
    throw err;
  }

  const lead = await captureLead({
    email: input.email,
    name: input.name,
    phone,
    source: 'guia-blindaje-sat',
    meta: { deliveredResource: GUIDE_FILENAME },
  });

  if (!fs.existsSync(GUIDE_PATH)) {
    const err: any = new Error('La guía no está disponible en el servidor.');
    err.statusCode = 500;
    throw err;
  }

  await sendGuideEmail({
    email: lead.email,
    name: lead.name,
    guidePath: GUIDE_PATH,
    guideFilename: GUIDE_FILENAME,
  });

  lead.emailedAt = new Date();
  await lead.save();

  return lead;
};

export const sendMediaKit = async (input: {
  email: string;
  name?: string;
  phone?: string;
}): Promise<ILeadDocument> => {
  const phone = input.phone?.trim();
  if (!phone) {
    const err: any = new Error('El número de teléfono es requerido.');
    err.statusCode = 400;
    throw err;
  }

  const downloadUrl = MEDIA_KIT_URL;

  const lead = await captureLead({
    email: input.email,
    name: input.name,
    phone,
    source: 'media-kit',
    meta: { deliveredResource: 'DDMedia-Kit.pdf', downloadUrl },
  });

  await sendMediaKitEmail({
    email: lead.email,
    name: lead.name,
    downloadUrl,
  });

  lead.emailedAt = new Date();
  await lead.save();

  return lead;
};

export const sendEstrategiaFiscalDossier = async (input: {
  email: string;
  name?: string;
  phone?: string;
}): Promise<ILeadDocument> => {
  const phone = input.phone?.trim();
  if (!phone) {
    const err: any = new Error('El número de teléfono es requerido.');
    err.statusCode = 400;
    throw err;
  }

  const lead = await captureLead({
    email: input.email,
    name: input.name,
    phone,
    source: 'estrategia-fiscal-dossier',
    meta: { deliveredResource: ESTRATEGIA_FISCAL_DOSSIER_FILENAME },
  });

  if (!fs.existsSync(ESTRATEGIA_FISCAL_DOSSIER_PATH)) {
    const err: any = new Error('El dossier no está disponible en el servidor.');
    err.statusCode = 500;
    throw err;
  }

  await sendEstrategiaFiscalDossierEmail({
    email: lead.email,
    name: lead.name,
    phone: lead.phone,
    dossierPath: ESTRATEGIA_FISCAL_DOSSIER_PATH,
    dossierFilename: ESTRATEGIA_FISCAL_DOSSIER_FILENAME,
  });

  lead.emailedAt = new Date();
  await lead.save();

  return lead;
};

export const sendDownloadableResource = async (input: {
  email: string;
  name?: string;
  phone?: string;
  resourceId: string;
  resourceTitle: string;
  downloadUrl: string;
}): Promise<ILeadDocument> => {
  const resourceTitle = input.resourceTitle.trim();
  const downloadUrl = input.downloadUrl.trim();
  const resourceId = input.resourceId.trim();

  if (!resourceTitle || !downloadUrl || !resourceId) {
    const err: any = new Error('La información del recurso es requerida.');
    err.statusCode = 400;
    throw err;
  }

  if (!isAllowedResourceUrl(downloadUrl)) {
    const err: any = new Error('El enlace del recurso no es válido.');
    err.statusCode = 400;
    throw err;
  }

  const phone = input.phone?.trim();
  if (!phone) {
    const err: any = new Error('El número de teléfono es requerido.');
    err.statusCode = 400;
    throw err;
  }

  const lead = await captureLead({
    email: input.email,
    name: input.name,
    phone,
    source: 'centro-recursos',
    meta: {
      deliveredResource: resourceTitle,
      resourceId,
      downloadUrl,
      sourceLabel: 'centro-recursos',
    },
  });

  await sendDownloadableResourceEmail({
    email: lead.email,
    name: lead.name,
    resourceTitle,
    downloadUrl,
  });

  lead.emailedAt = new Date();
  await lead.save();

  return lead;
};

export const subscribeNewsletter = async (input: {
  email: string;
  name?: string;
  meta?: Record<string, unknown>;
}): Promise<ILeadDocument> => {
  return captureLead({
    email: input.email,
    name: input.name,
    source: 'newsletter',
    meta: {
      leadType: 'mailing-subscription',
      ...(input.meta ?? {}),
    },
  });
};

export const subscribeSatWaitlist = async (input: {
  email: string;
  name?: string;
  phone?: string;
}): Promise<ILeadDocument> => {
  const phone = input.phone?.trim();
  if (!phone) {
    const err: any = new Error('El número de teléfono es requerido.');
    err.statusCode = 400;
    throw err;
  }

  return captureLead({
    email: input.email,
    name: input.name,
    phone,
    source: 'libro-sat-waitlist',
    meta: { deliveredResource: 'Capítulo 1 · Los 7 secretos que el SAT no quiere que conozcas' },
  });
};

export const listLeads = async (source?: LeadSource, email?: string): Promise<ILeadDocument[]> => {
  const filter: Record<string, unknown> = {};
  if (source) filter.source = source;
  if (email) filter.email = normalizeEmail(email);
  const leads = await Lead.find(filter);
  return leads.sort(
    (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
  );
};

export interface UnifiedLead {
  id: string;
  email: string;
  name: string;
  phone?: string;
  sources: string[];
  reasons: string[];
  userId?: string;
  leadIds: string[];
  firstSeenAt: string;
  lastActivityAt: string;
}

const LEAD_REASON_LABELS: Record<string, string> = {
  'guia-blindaje-sat': 'Guía SAT',
  'media-kit': 'Media Kit',
  newsletter: 'Newsletter',
  'centro-recursos': 'Centro de recursos',
  'estrategia-fiscal-dossier': 'Dossier Estrategia Fiscal',
  'libro-sat-waitlist': 'Lista de espera · Libro SAT',
  contact: 'Formulario de contacto',
  other: 'Otro',
};

const INCOMPLETE_PAYMENT_TAG_PREFIX = 'Pago incompleto: ';

// Une la tabla `leads` (newsletter/media-kit/guias) con los usuarios que
// nunca completaron una compra (contactStatus 'lead' — incluye a quien tiene
// el tag "Pago incompleto: X" de markIncompletePayment en user.service.ts, y
// a cualquier registro sin ese tag). Se excluye a quien ya sea cliente,
// aunque tenga historial viejo en `leads` — al pagar, confirmPayment/
// grantAcademiaAccess ya lo pasan a contactStatus 'customer'.
export const listUnifiedLeads = async (): Promise<UnifiedLead[]> => {
  const [leads, users, tags] = await Promise.all([Lead.find({}), User.find({}), Tag.find({})]);
  const tagNameById = new Map(tags.map((tag) => [String(tag._id), tag.name]));
  const userByEmail = new Map(users.map((user) => [normalizeEmail(user.email || ''), user]));

  const merged = new Map<string, UnifiedLead>();

  const touch = (
    email: string,
    name: string,
    phone: string | undefined,
    source: string,
    reason: string,
    at: string,
    leadId?: string,
    userId?: string,
  ): void => {
    if (!email) return;
    const existing = merged.get(email);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (name && !existing.name) existing.name = name;
      if (phone && !existing.phone) existing.phone = phone;
      if (leadId) existing.leadIds.push(leadId);
      if (userId) existing.userId = userId;
      if (at < existing.firstSeenAt) existing.firstSeenAt = at;
      if (at > existing.lastActivityAt) existing.lastActivityAt = at;
      return;
    }
    merged.set(email, {
      id: userId ? `user:${userId}` : `lead:${leadId}`,
      email,
      name: name || '',
      phone,
      sources: [source],
      reasons: [reason],
      userId,
      leadIds: leadId ? [leadId] : [],
      firstSeenAt: at,
      lastActivityAt: at,
    });
  };

  for (const lead of leads) {
    const email = normalizeEmail(lead.email);
    const at = String(lead.createdAt);
    const reason = LEAD_REASON_LABELS[lead.source] ?? lead.source;
    touch(email, lead.name || '', lead.phone, lead.source, reason, at, String(lead._id));
  }

  for (const user of users) {
    if (user.contactStatus !== 'lead') continue;
    const email = normalizeEmail(user.email || '');
    if (!email) continue;
    const at = String(user.createdAt);

    const incompleteTagNames = (user.tagIds ?? [])
      .map((tagId) => tagNameById.get(tagId))
      .filter((name): name is string => Boolean(name && name.startsWith(INCOMPLETE_PAYMENT_TAG_PREFIX)));

    if (incompleteTagNames.length) {
      for (const tagName of incompleteTagNames) {
        const reason = `Intento de compra: ${tagName.slice(INCOMPLETE_PAYMENT_TAG_PREFIX.length)}`;
        touch(email, user.name || '', user.phone, 'compra-incompleta', reason, at, undefined, String(user._id));
      }
    } else {
      touch(email, user.name || '', user.phone, 'compra-incompleta', 'Registro sin compra completada', at, undefined, String(user._id));
    }
  }

  const result = Array.from(merged.values()).filter((entry) => {
    const user = userByEmail.get(entry.email);
    return !user || user.contactStatus !== 'customer';
  });

  return result.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
};

export const deleteLead = async (id: string): Promise<ILeadDocument | null> => {
  if (!id?.trim()) {
    const err: any = new Error('El lead es requerido.');
    err.statusCode = 400;
    throw err;
  }

  return Lead.findByIdAndDelete(id.trim());
};

export const deleteLeads = async (ids: string[]): Promise<{ deleted: number; missing: string[] }> => {
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    const err: any = new Error('Selecciona al menos un lead.');
    err.statusCode = 400;
    throw err;
  }
  if (uniqueIds.length > 500) {
    const err: any = new Error('Puedes borrar máximo 500 leads por operación.');
    err.statusCode = 400;
    throw err;
  }

  let deleted = 0;
  const missing: string[] = [];

  for (const id of uniqueIds) {
    const removed = await Lead.findByIdAndDelete(id);
    if (removed) deleted += 1;
    else missing.push(id);
  }

  return { deleted, missing };
};
