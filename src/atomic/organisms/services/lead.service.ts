import path from 'node:path';
import fs from 'node:fs';
import { Lead, ILeadDocument, LeadSource } from '../../molecules/models/lead.model.js';
import { env } from '../../../config/env.js';
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
    const allowedOrigins = new Set([
      new URL(env.clientUrl).origin,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    return allowedOrigins.has(url.origin);
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
}): Promise<ILeadDocument> => {
  const lead = await captureLead({
    email: input.email,
    name: input.name,
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
}): Promise<ILeadDocument> => {
  const downloadUrl = MEDIA_KIT_URL;

  const lead = await captureLead({
    email: input.email,
    name: input.name,
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

  const lead = await captureLead({
    email: input.email,
    name: input.name,
    phone: input.phone,
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
}): Promise<ILeadDocument> => {
  return captureLead({
    email: input.email,
    name: input.name,
    source: 'newsletter',
  });
};

export const listLeads = async (source?: LeadSource): Promise<ILeadDocument[]> => {
  const filter = source ? { source } : {};
  const leads = await Lead.find(filter);
  return leads.sort(
    (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
  );
};
