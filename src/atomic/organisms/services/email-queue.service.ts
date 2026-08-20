import { EmailQueueJob, IEmailQueueJobDocument } from '../../molecules/models/email-queue.model.js';
import { sendMigrationWelcome } from './email.service.js';

// Google Workspace permite 2000 correos/dia; dejamos margen de seguridad.
const DAILY_SEND_CAP = 1800;
// Ritmo de envio conservador para no disparar los limites por minuto de Gmail.
const SEND_INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 5;

let workerStarted = false;

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

const countSentInLast24h = async (): Promise<number> => {
  const sentJobs = await EmailQueueJob.find({ status: 'sent' });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return sentJobs.filter((job) => new Date(String(job.sentAt ?? job.updatedAt)).getTime() >= cutoff).length;
};

const processNext = async (): Promise<void> => {
  try {
    const sentToday = await countSentInLast24h();
    if (sentToday >= DAILY_SEND_CAP) return;

    const [job] = await EmailQueueJob.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(1);
    if (!job) return;

    try {
      await sendMigrationWelcome({ name: job.toName, email: job.toEmail }, job.tempPassword);
      await EmailQueueJob.findByIdAndUpdate(job._id, { status: 'sent', sentAt: new Date().toISOString() });
    } catch (err) {
      const attempts = Number(job.attempts ?? 0) + 1;
      await EmailQueueJob.findByIdAndUpdate(job._id, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        lastError: (err as Error).message,
      });
    }
  } catch (err) {
    console.error('[email-queue] worker error:', (err as Error).message);
  }
};

export const startEmailQueueWorker = (): void => {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => { void processNext(); }, SEND_INTERVAL_MS);
  console.log(`[email-queue] worker started (1 email / ${SEND_INTERVAL_MS}ms, cap ${DAILY_SEND_CAP}/24h)`);
};

export const getQueueStatus = async (kind: IEmailQueueJobDocument['kind'] = 'migration_welcome') => {
  const jobs = await EmailQueueJob.find({ kind });
  return {
    total: jobs.length,
    pending: jobs.filter((j) => j.status === 'pending').length,
    sent: jobs.filter((j) => j.status === 'sent').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    sentLast24h: await countSentInLast24h(),
    dailyCap: DAILY_SEND_CAP,
  };
};
