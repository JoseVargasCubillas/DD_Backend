import { env } from '../../../config/env.js';

// WhatsApp Cloud API oficial de Meta. Para escribirle a alguien que no tiene
// una conversación abierta con el número (los avisos de envío son siempre
// así) Meta solo permite PLANTILLAS aprobadas, no texto libre. Cada plantilla
// se crea y aprueba en WhatsApp Manager; aquí solo se envía por nombre con sus
// variables {{1}}, {{2}}… en orden.

const TIMEOUT_MS = 20000;

export interface CloudSendResult {
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  error?: string;
}

export const isWhatsappCloudConfigured = (): boolean =>
  Boolean(env.whatsapp.cloud.token && env.whatsapp.cloud.phoneNumberId);

// Meta espera el número en formato internacional solo con dígitos. Un móvil
// mexicano de 10 dígitos lleva 52 al frente; si ya trae lada de país (11-15
// dígitos) se respeta, quitando el "1" antiguo de móviles MX (521…).
export const toCloudRecipient = (rawPhone: string): string => {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 13 && digits.startsWith('521')) digits = `52${digits.slice(3)}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : '';
};

// Meta rechaza variables con saltos de línea, tabulaciones o 4+ espacios
// seguidos, y limita su largo. Se normaliza todo a una sola línea.
export const sanitizeTemplateParam = (value: unknown): string => {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return (text || '—').slice(0, 400);
};

// `name` solo se usa con plantillas de variables con nombre ({{asesor}}):
// minúsculas, números y guiones bajos, sin acentos. En modo posicional se
// ignora y el orden del arreglo es el que cuenta.
export interface TemplateParam {
  name: string;
  value: string;
}

export const sendWhatsappTemplate = async (input: {
  to: string;
  template: string;
  params: TemplateParam[];
}): Promise<CloudSendResult> => {
  if (!isWhatsappCloudConfigured()) {
    return { status: 'skipped', error: 'WHATSAPP_CLOUD_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados' };
  }
  const to = toCloudRecipient(input.to);
  if (!to) return { status: 'failed', error: 'Teléfono inválido' };

  const { token, phoneNumberId, apiVersion, language, paramFormat } = env.whatsapp.cloud;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: input.template,
          language: { code: language },
          components: input.params.length
            ? [
                {
                  type: 'body',
                  parameters: input.params.map((p) => ({
                    type: 'text',
                    ...(paramFormat === 'named' ? { parameter_name: p.name } : {}),
                    text: sanitizeTemplateParam(p.value),
                  })),
                },
              ]
            : [],
        },
      }),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };

    if (!res.ok || data.error) {
      const code = data.error?.code ? ` [${data.error.code}]` : '';
      const detail = data.error?.error_data?.details || data.error?.message || `HTTP ${res.status}`;
      console.error(`[whatsapp-cloud] ${input.template} → ${to}${code}:`, detail);
      return { status: 'failed', error: `${detail}${code}` };
    }
    return { status: 'sent', messageId: data.messages?.[0]?.id ?? '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp-cloud] error de red (${input.template}):`, msg);
    return { status: 'failed', error: msg };
  } finally {
    clearTimeout(timer);
  }
};
