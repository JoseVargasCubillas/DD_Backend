import path from 'node:path';
import fs from 'node:fs';
import {
  EmailQueueJob,
  IEmailQueueJobDocument,
  EmailQueueKind,
  TRANSACTIONAL_KINDS,
} from '../../molecules/models/email-queue.model.js';
import { Lead } from '../../molecules/models/lead.model.js';
import {
  sendMigrationWelcome,
  sendGuideEmail,
  sendMediaKitEmail,
  sendEstrategiaFiscalDossierEmail,
  sendDownloadableResourceEmail,
  sendNewsletterWelcomeEmail,
  sendCredentials,
  sendHoldingOfferEmail,
} from './email.service.js';

/**
 * Google Workspace permite ~2,000 correos/dia. Repartimos:
 * - BULK_SEND_CAP (1,800): jobs 'migration_welcome' y campañas masivas.
 * - TOTAL_SEND_CAP (1,950): tope duro que respetan también los transaccionales,
 *   dejando 50 de margen para no romper la cuenta si Gmail truena.
 * De este modo quedan ~150 emails al dia reservados solo para
 * transaccionales (descargas, confirmaciones, bienvenidas).
 */
const BULK_SEND_CAP = Number(process.env.EMAIL_BULK_DAILY_CAP) || 1800;
const TOTAL_SEND_CAP = Number(process.env.EMAIL_TOTAL_DAILY_CAP) || 1950;
const SEND_INTERVAL_MS = Number(process.env.EMAIL_QUEUE_INTERVAL_MS) || 2500;
const MAX_ATTEMPTS = 5;

let workerStarted = false;
// Cuando SMTP rechaza por cap diario, pausamos el worker hasta este timestamp.
let pausedUntil = 0;

export const enqueueMigrationWelcome = async (input: {
  name: string;
  email: string;
  tempPassword: string;
}): Promise<void> => {
  await EmailQueueJob.create({
    kind: 'migration_welcome',
    toEmail: input.email,
    toName: input.name,
    tempPassword: input.tempPassword,
  } as Partial<IEmailQueueJobDocument>);
};

/**
 * Encola un email transaccional de lead que fallo el envio inmediato (cap
 * diario alcanzado o SMTP caido). El worker lo procesara en cuanto haya
 * capacidad, priorizando siempre transaccionales sobre bulk.
 */
export const enqueueLeadTransactional = async (input: {
  kind: Exclude<EmailQueueKind, 'migration_welcome'>;
  leadId?: string;
  toEmail: string;
  toName?: string;
  payload?: Record<string, unknown>;
}): Promise<void> => {
  // Evita duplicados: si ya hay un job pending del mismo kind para el mismo
  // correo, no lo encolamos otra vez.
  const existing = await EmailQueueJob.find({
    kind: input.kind,
    toEmail: input.toEmail,
    status: 'pending',
  });
  if (existing.length > 0) return;
  await EmailQueueJob.create({
    kind: input.kind,
    toEmail: input.toEmail,
    toName: input.toName,
    payload: input.payload ?? {},
    leadId: input.leadId,
  } as Partial<IEmailQueueJobDocument>);
};

/**
 * Encola credenciales de acceso de un usuario (alta por admin o reset de
 * contraseña). Prioridad transaccional — se despacha antes que cualquier
 * bulk. Guarda la tempPassword en el job porque el email la necesita.
 */
export const enqueueUserCredentials = async (input: {
  kind: 'user_credentials' | 'user_password_reset';
  toEmail: string;
  toName: string;
  tempPassword: string;
  isNew?: boolean;
}): Promise<void> => {
  // Cuando hay un job pending del mismo kind + email, reemplazamos su
  // tempPassword — asi la ultima contraseña generada es la que se envia.
  const existing = await EmailQueueJob.find({
    kind: input.kind,
    toEmail: input.toEmail,
    status: 'pending',
  });
  if (existing.length > 0) {
    await EmailQueueJob.findByIdAndUpdate(existing[0]._id, {
      tempPassword: input.tempPassword,
      toName: input.toName,
      payload: { isNew: input.isNew ?? true },
      attempts: 0,
      lastError: undefined,
    });
    return;
  }
  await EmailQueueJob.create({
    kind: input.kind,
    toEmail: input.toEmail,
    toName: input.toName,
    tempPassword: input.tempPassword,
    payload: { isNew: input.isNew ?? true },
  } as Partial<IEmailQueueJobDocument>);
};

const countSentInLast24h = async (): Promise<number> => {
  const sentJobs = await EmailQueueJob.find({ status: 'sent' });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return sentJobs.filter(
    (job) => new Date(String(job.sentAt ?? job.updatedAt)).getTime() >= cutoff,
  ).length;
};

const GUIDE_PATH = path.resolve(process.cwd(), 'assets', 'iniciativa-fiscal-2027.pdf');
const GUIDE_FILENAME = 'Iniciativa-Fiscal-2027-Diego-Diaz.pdf';
const DOSSIER_PATH = path.resolve(
  process.cwd(),
  'assets',
  'seminario-estrategia-fiscal-dossier.pdf',
);
const DOSSIER_FILENAME = 'Seminario-Estrategia-Fiscal-Diego-Diaz.pdf';

const dispatchJob = async (job: IEmailQueueJobDocument): Promise<void> => {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const downloadUrl = String(payload.downloadUrl ?? '');
  switch (job.kind) {
    case 'migration_welcome':
      if (!job.tempPassword || !job.toName) {
        throw new Error('migration_welcome sin tempPassword/toName');
      }
      await sendMigrationWelcome({ name: job.toName, email: job.toEmail }, job.tempPassword);
      return;
    case 'lead_sat_guide':
      if (!fs.existsSync(GUIDE_PATH)) throw new Error('guia no encontrada');
      await sendGuideEmail({
        email: job.toEmail,
        name: job.toName,
        guidePath: GUIDE_PATH,
        guideFilename: GUIDE_FILENAME,
      });
      return;
    case 'lead_media_kit':
      await sendMediaKitEmail({
        email: job.toEmail,
        name: job.toName,
        downloadUrl,
      });
      return;
    case 'lead_estrategia_dossier':
      if (!fs.existsSync(DOSSIER_PATH)) throw new Error('dossier no encontrado');
      await sendEstrategiaFiscalDossierEmail({
        email: job.toEmail,
        name: job.toName,
        phone: String(payload.phone ?? ''),
        dossierPath: DOSSIER_PATH,
        dossierFilename: DOSSIER_FILENAME,
      });
      return;
    case 'lead_resource_download':
      await sendDownloadableResourceEmail({
        email: job.toEmail,
        name: job.toName,
        resourceTitle: String(payload.resourceTitle ?? ''),
        downloadUrl,
      });
      return;
    case 'lead_newsletter_welcome':
      await sendNewsletterWelcomeEmail({ email: job.toEmail, name: job.toName });
      return;
    case 'user_credentials':
      // Creación de usuario por admin (o import): reenvía credenciales
      // guardadas en tempPassword.
      if (!job.tempPassword || !job.toName) {
        throw new Error('user_credentials sin tempPassword/toName');
      }
      await sendCredentials(
        { name: job.toName, email: job.toEmail },
        job.tempPassword,
        { isNew: Boolean(payload.isNew ?? true) },
      );
      return;
    case 'user_password_reset':
      if (!job.tempPassword || !job.toName) {
        throw new Error('user_password_reset sin tempPassword/toName');
      }
      await sendCredentials(
        { name: job.toName, email: job.toEmail },
        job.tempPassword,
        { isNew: false },
      );
      return;
    case 'holding_offer':
      // Campana Holding — el payload trae contextLine + precios.
      await sendHoldingOfferEmail({
        email: job.toEmail,
        name: job.toName ?? '',
        contextLine: String(payload.contextLine ?? ''),
        stripeUrl: String(payload.stripeUrl ?? 'https://buy.stripe.com/aFadR8djo87lc5Z4MIgjC3v'),
        offerPrice: Number(payload.offerPrice ?? 1500),
        regularPrice: Number(payload.regularPrice ?? 1997),
        eventDateLabel: String(payload.eventDateLabel ?? '22 de septiembre'),
        deadlineLabel: String(payload.deadlineLabel ?? 'hoy a las 11:59 PM'),
      });
      return;
    default:
      throw new Error(`kind desconocido: ${(job as { kind?: string }).kind ?? ''}`);
  }
};

const BULK_KINDS: EmailQueueKind[] = ['migration_welcome', 'holding_offer'];

const pickNextJob = async (sentToday: number): Promise<IEmailQueueJobDocument | undefined> => {
  // Siempre priorizar transaccionales — mientras haya cap total.
  if (sentToday < TOTAL_SEND_CAP) {
    const transactional = await EmailQueueJob.find({ status: 'pending' });
    const trans = transactional
      .filter((j) => TRANSACTIONAL_KINDS.includes(j.kind))
      .sort(
        (a, b) => new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime(),
      );
    if (trans[0]) return trans[0];
  }
  // Bulk (migration_welcome + holding_offer) solo dentro del cap de bulk.
  if (sentToday < BULK_SEND_CAP) {
    const pending = await EmailQueueJob.find({ status: 'pending' });
    const bulk = pending
      .filter((j) => BULK_KINDS.includes(j.kind))
      .sort(
        (a, b) => new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime(),
      );
    if (bulk[0]) return bulk[0];
  }
  return undefined;
};

const processNext = async (): Promise<void> => {
  try {
    if (Date.now() < pausedUntil) return;
    const sentToday = await countSentInLast24h();
    if (sentToday >= TOTAL_SEND_CAP) return;

    const job = await pickNextJob(sentToday);
    if (!job) return;

    try {
      await dispatchJob(job);
      await EmailQueueJob.findByIdAndUpdate(job._id, {
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
      // Marca el Lead como entregado si el job estaba vinculado.
      if (job.leadId && TRANSACTIONAL_KINDS.includes(job.kind)) {
        try {
          const lead = await Lead.findById(job.leadId);
          if (lead) {
            lead.emailedAt = new Date();
            lead.meta = {
              ...(lead.meta ?? {}),
              emailPending: false,
              emailDeliveredAt: new Date().toISOString(),
            };
            await lead.save();
          }
        } catch (leadErr) {
          console.warn('[email-queue] no pude marcar lead entregado:', (leadErr as Error).message);
        }
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      // Errores de cap diario / rate limit no queman attempts: el job queda
      // pending para reintentarse cuando el cap reseté. Ademas pausamos el
      // worker una hora para no golpear SMTP en vacio.
      const isCapExceeded = /daily user sending limit|sending limits|rate limit|too many|quota|4\.7\.0|5\.4\.5/i.test(message);
      if (isCapExceeded) {
        pausedUntil = Date.now() + 15 * 60 * 1000;
        await EmailQueueJob.findByIdAndUpdate(job._id, {
          status: 'pending',
          lastError: message,
        });
        console.warn('[email-queue] SMTP cap alcanzado, pauso worker 15 min. Job vuelve a pending.');
      } else {
        const attempts = Number(job.attempts ?? 0) + 1;
        await EmailQueueJob.findByIdAndUpdate(job._id, {
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          lastError: message,
        });
      }
    }
  } catch (err) {
    console.error('[email-queue] worker error:', (err as Error).message);
  }
};

export const startEmailQueueWorker = (): void => {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    void processNext();
  }, SEND_INTERVAL_MS);
  console.log(
    `[email-queue] worker started (1 email / ${SEND_INTERVAL_MS}ms, bulk cap ${BULK_SEND_CAP}/24h, total cap ${TOTAL_SEND_CAP}/24h)`,
  );
};

export const getQueueStatus = async (kind: IEmailQueueJobDocument['kind'] = 'migration_welcome') => {
  const jobs = await EmailQueueJob.find({ kind });
  return {
    total: jobs.length,
    pending: jobs.filter((j) => j.status === 'pending').length,
    sent: jobs.filter((j) => j.status === 'sent').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    sentLast24h: await countSentInLast24h(),
    bulkCap: BULK_SEND_CAP,
    totalCap: TOTAL_SEND_CAP,
  };
};
