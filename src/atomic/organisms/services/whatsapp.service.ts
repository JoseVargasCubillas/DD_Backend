import { env } from '../../../config/env.js';

// Envio masivo/personal por Whapi.cloud — misma cuenta y token que usa el
// backend de Consultoria. Se comparte porque en Whapi cada token ata la sesion
// a un unico numero de WhatsApp; correr dos aplicaciones contra el mismo token
// significa que ambas envian desde ese mismo numero, que es exactamente lo que
// se busca aqui (el usuario prefiere que la Academia mande desde el numero
// oficial ya conectado en la Consultoria).

const WHAPI_TIMEOUT_MS = 15000;

// Whapi impone rate limits y una sesion inestable no aguanta rafagas. Un
// intervalo conservador evita que la primera parte del broadcast queme el
// numero antes de que llegue a la mitad de la lista.
const SEND_INTERVAL_MS = 1200;

const isConfigured = (): boolean => Boolean(env.whatsapp.whapiToken);

// Whapi espera "<digitos>@s.whatsapp.net". Los MX de 10 digitos necesitan el
// prefijo "521" (movil real); un JID mal formado se queda en 'pending' para
// siempre asi que se descarta antes de enviarlo.
const normalizeRecipient = (rawPhone: string): string => {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';

  let withCountry = digits;
  if (withCountry.length === 10) {
    withCountry = `521${withCountry}`;
  } else if (withCountry.length === 12 && withCountry.startsWith('52')) {
    // "52<numero>" en fijo se corrige a "521<numero>" para que Whapi lo
    // enrute como movil; en numeros no-MX el usuario ya trae su lada real.
    withCountry = `521${withCountry.slice(2)}`;
  }

  return `${withCountry}@s.whatsapp.net`;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface SendResult {
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  error?: string;
}

export const sendWhatsappMessage = async (
  toPhoneNumber: string,
  messageText: string,
): Promise<SendResult> => {
  if (!isConfigured()) {
    return { status: 'skipped', error: 'WHAPI_TOKEN no configurado.' };
  }

  const to = normalizeRecipient(toPhoneNumber);
  if (!to) return { status: 'failed', error: 'Telefono invalido.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WHAPI_TIMEOUT_MS);

  try {
    const res = await fetch(`${env.whatsapp.whapiUrl}/messages/text`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsapp.whapiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, body: messageText }),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as {
      message?: { id?: string };
      id?: string;
      sent?: boolean | { id?: string };
      error?: { message?: string };
    };

    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      console.error(`[whatsapp] fallo a ${toPhoneNumber}:`, errMsg);
      return { status: 'failed', error: errMsg };
    }

    const messageId =
      data.message?.id || data.id || (typeof data.sent === 'object' ? data.sent?.id : undefined) || '';
    const isFailed = data.sent === false;

    return { status: isFailed ? 'failed' : 'sent', messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] error red a ${toPhoneNumber}:`, msg);
    return { status: 'failed', error: msg };
  } finally {
    clearTimeout(timeout);
  }
};

export interface BulkRecipient {
  name?: string;
  phone: string;
}

export interface BulkResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

// Reemplaza {{name}} por el nombre del destinatario para personalizacion
// minima estilo mail merge. Si el nombre viene vacio se sustituye por una
// forma neutra para no dejar el placeholder crudo en el mensaje.
const renderMessage = (template: string, recipient: BulkRecipient): string => {
  const name = (recipient.name || '').trim();
  const fallback = 'hola';
  return template.replace(/\{\{\s*name\s*\}\}/gi, name || fallback);
};

export const sendWhatsappBroadcast = async (
  recipients: BulkRecipient[],
  message: string,
): Promise<BulkResult> => {
  const result: BulkResult = { sent: 0, failed: 0, skipped: 0, total: recipients.length };

  for (let i = 0; i < recipients.length; i += 1) {
    const rec = recipients[i];
    if (!rec.phone?.trim()) {
      result.skipped += 1;
      continue;
    }

    const outcome = await sendWhatsappMessage(rec.phone, renderMessage(message, rec));
    if (outcome.status === 'sent') result.sent += 1;
    else if (outcome.status === 'skipped') result.skipped += 1;
    else result.failed += 1;

    // Espaciado entre envios — el ultimo no necesita esperar.
    if (i < recipients.length - 1) await delay(SEND_INTERVAL_MS);
  }

  return result;
};

export const isWhatsappBroadcastConfigured = isConfigured;
