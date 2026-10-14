import { createHmac, timingSafeEqual } from 'node:crypto';

// Mailchimp rechaza como repetición cualquier entrega con más de 5 minutos de diferencia.
const TOLERANCE_SECONDS = 300;

/**
 * Verifica la firma opcional de los webhooks de Mailchimp.
 *
 * Cabecera: `X-Mailchimp-Signature: t={timestamp},v1={hex}`
 * Firma:    HMAC-SHA256(clave = signing secret, mensaje = "{timestamp}.{cuerpo crudo}")
 *
 * El cuerpo debe ser exactamente el que llegó (bytes), no uno reconstruido.
 * https://mailchimp.com/developer/marketing/api-concepts/webhooks
 */
export const verifyMailchimpSignature = (
  rawBody: Buffer | string | undefined,
  header: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean => {
  if (!rawBody || !header || !secret) return false;

  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const i = piece.indexOf('=');
    if (i > 0) parts.set(piece.slice(0, i).trim(), piece.slice(i + 1).trim());
  }

  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};
