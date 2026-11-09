/**
 * Eventos online con acceso por grupo de WhatsApp (Holding y SEF Online).
 *
 * Quien compra uno de estos productos (en la página o por un negocio ganado en
 * HubSpot) recibe un bloque verde "Únete al grupo de WhatsApp" con un enlace de
 * un solo uso, como en Academia. El enlace real del grupo nunca se manda: se
 * manda uno propio que, al abrirse la primera vez, redirige al grupo.
 *
 * Los enlaces de los grupos viven en el .env (WHATSAPP_GROUP_HOLDING_URL y
 * WHATSAPP_GROUP_SEF_ONLINE_URL). Sin enlace configurado, el producto no manda
 * el bloque.
 */

import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { env } from '../../../config/env.js';
import { EventGroupInvite } from '../../molecules/models/event-group-invite.model.js';
import { registerOnlineAttendee } from './ticket.service.js';

export type GroupKey = 'holding' | 'sef-online';

const GROUPS: Record<GroupKey, { label: string; url: () => string }> = {
  holding: { label: 'Holding', url: () => env.whatsapp.holdingGroupUrl },
  'sef-online': { label: 'Seminario Estrategia Fiscal Online', url: () => env.whatsapp.sefOnlineGroupUrl },
};

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Decide si un producto/evento es de los que llevan grupo. Recibe cualquier
// texto que lo describa (refId del catálogo, slug, título, nombre del producto
// de HubSpot, formato) y devuelve el grupo o null.
//   · Holding            → siempre es online.
//   · SEF / Estrategia Fiscal → solo su edición online.
export const detectGroupProduct = (...parts: Array<string | undefined | null>): GroupKey | null => {
  const text = norm(parts.filter(Boolean).join(' '));
  if (!text) return null;
  if (/\bholding\b/.test(text)) return 'holding';
  const isSef = /\bsef\b/.test(text) || text.includes('estrategia fiscal');
  const isOnline = /\b(online|virtual|zoom|en linea)\b/.test(text);
  if (isSef && isOnline && !/\bpresencial\b/.test(text)) return 'sef-online';
  return null;
};

export const groupLabel = (key: GroupKey): string => GROUPS[key].label;

const GROUP_URL_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?(\?.*)?$/;

// Enlace real del grupo (nunca se manda por correo). Cada edición tiene el suyo
// en el campo "Grupo de WhatsApp" del evento (admin → Eventos); sin él, el del
// .env como respaldo. Null si tampoco existe.
// `strict`: sin enlace propio de la edición NO se usa el del .env. El .env guarda
// el grupo de una edición vieja; con strict, una edición nueva sin grupo queda
// pendiente en vez de mandar a los compradores al grupo equivocado.
export const resolveGroupUrl = (key: GroupKey, eventGroupUrl?: string | null, strict = false): string | null => {
  const own = String(eventGroupUrl ?? '').trim();
  if (GROUP_URL_RE.test(own)) return own;
  if (strict) return null;
  return GROUPS[key].url().trim() || null;
};

export const isGroupConfigured = (key: GroupKey, eventGroupUrl?: string | null, strict = false): boolean =>
  Boolean(resolveGroupUrl(key, eventGroupUrl, strict));

export const buildGroupJoinUrl = (token: string): string =>
  `${env.serverUrl.replace(/\/$/, '')}/api/v1/event-groups/${token}`;

export interface GroupInviteCard {
  label: string;
  joinUrl: string;
  qrCid: string;
  qrPng: Buffer;
  token: string;
}

// Crea (o recupera) la invitación de una compra. Idempotente por `ref`.
export const issueGroupInvite = async (input: {
  ref: string;
  key: GroupKey;
  email: string;
  name: string;
  // Enlace del grupo de la edición comprada (campo del evento); sin él, el del .env.
  groupUrl?: string | null;
  // true: exige el enlace propio de la edición (sin respaldo del .env).
  strict?: boolean;
  // Evento y venta: con ellos el inscrito entra a la lista de asistentes del evento.
  eventRefId?: string;
  eventSlug?: string;
  eventTitle?: string;
  eventDate?: string;
  amount?: number;
  advisorName?: string;
}): Promise<GroupInviteCard | null> => {
  let invite = await EventGroupInvite.findOne({ ref: input.ref });
  if (!invite) {
    // El enlace de la edición se fija al emitir: si el admin cambia o agrega
    // grupos después, quien ya compró conserva el suyo.
    const groupUrl = resolveGroupUrl(input.key, input.groupUrl, input.strict);
    if (!groupUrl) return null;
    invite = await EventGroupInvite.create({
      ref: input.ref,
      groupKey: input.key,
      groupUrl,
      token: randomUUID(),
      email: input.email.trim().toLowerCase(),
      name: input.name,
      usedAt: null,
    });
  }
  // Lista de asistentes del evento (misma tabla que los boletos). No debe romper
  // la compra ni el correo: si falla, la invitación sale igual.
  if (input.eventTitle) {
    try {
      await registerOnlineAttendee({
        ref: input.ref,
        eventRefId: input.eventRefId ?? '',
        eventSlug: input.eventSlug ?? '',
        eventTitle: input.eventTitle,
        eventDate: input.eventDate ?? '',
        attendee: { name: input.name, email: invite.email },
        amount: input.amount ?? 0,
        advisorName: input.advisorName,
      });
    } catch (err) {
      console.warn('[event-group] no se pudo registrar al inscrito online:', (err as Error).message);
    }
  }
  return cardFromToken(invite.token, input.key);
};

// Arma la tarjeta (enlace + QR) de una invitación ya emitida; sirve también
// para reintentar un correo que falló.
export const cardFromToken = async (token: string, key: GroupKey): Promise<GroupInviteCard> => {
  const joinUrl = buildGroupJoinUrl(token);
  const qrPng = await QRCode.toBuffer(joinUrl, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
    color: { dark: '#17130f', light: '#ffffff' },
  });
  return { label: GROUPS[key].label, joinUrl, qrCid: `grp-${token.slice(0, 12)}@diegodiaz.mx`, qrPng, token };
};

// Canjea el enlace: la primera vez resuelve al grupo real; después queda usado.
export const redeemGroupInvite = async (
  token: string,
): Promise<{ status: 'ok'; url: string } | { status: 'invalid' | 'used' }> => {
  const invite = await EventGroupInvite.findOne({ token });
  if (!invite) return { status: 'invalid' };
  if (invite.usedAt) return { status: 'used' };

  const url = invite.groupUrl?.trim() || resolveGroupUrl(invite.groupKey as GroupKey);
  if (!url) return { status: 'invalid' };

  invite.usedAt = new Date().toISOString();
  await invite.save();
  return { status: 'ok', url };
};
