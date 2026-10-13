import { EmailCampaign } from '../../molecules/models/email-campaign.model.js';
import type { SendCampaignResult } from './mailchimp.service.js';

// Un envío que lleva más tiempo "enviando" se considera trabado y ya no bloquea uno nuevo.
const STALE_SENDING_MS = 30 * 60 * 1000;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'Error desconocido');

/** Envío en curso más reciente, para impedir envíos simultáneos o por doble clic. */
export const findActiveSending = async () => {
  const sending = await EmailCampaign.find({ status: 'sending' });
  const cutoff = Date.now() - STALE_SENDING_MS;
  return sending.find((c) => new Date(c.createdAt).getTime() > cutoff) ?? null;
};

/**
 * Ejecuta el envío sin que el navegador espere y deja el resultado (o el
 * error) en el historial. Nunca lanza: corre desvinculado de la petición.
 */
export const runCampaignInBackground = (
  campaignDocId: string,
  job: () => Promise<SendCampaignResult>,
): void => {
  void (async () => {
    try {
      const result = await job();
      await EmailCampaign.findByIdAndUpdate(campaignDocId, {
        status: 'sent',
        error: '',
        recipientCount: result.recipientCount,
        mailchimpCampaignId: result.campaignId,
        mailchimpSegmentId: result.segmentId,
        syncErrors: result.syncErrors,
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[email] El envío en segundo plano falló:', messageOf(err));
      try {
        await EmailCampaign.findByIdAndUpdate(campaignDocId, { status: 'failed', error: messageOf(err) });
      } catch (updateErr) {
        console.error('[email] No se pudo registrar el fallo del envío:', messageOf(updateErr));
      }
    }
  })();
};

/**
 * Al arrancar el servidor: los envíos que quedaron "enviando" se interrumpieron
 * por un reinicio. Se marcan como fallidos y se avisa que revisen Mailchimp,
 * porque pudieron haber salido justo antes de caer.
 */
export const recoverInterruptedCampaigns = async (): Promise<void> => {
  const stuck = await EmailCampaign.find({ status: 'sending' });
  for (const campaign of stuck) {
    await EmailCampaign.findByIdAndUpdate(campaign._id, {
      status: 'failed',
      error: 'El servidor se reinició durante el envío. Revisa en Mailchimp si salió antes de reenviarla.',
    });
  }
  if (stuck.length > 0) console.warn(`[email] ${stuck.length} envío(s) interrumpido(s) por un reinicio.`);
};
