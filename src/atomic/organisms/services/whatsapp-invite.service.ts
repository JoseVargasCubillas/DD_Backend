import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';
import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';

// Solo los planes Business y Master traen grupo de WhatsApp (ver plansFallback
// en Academy/index.tsx del frontend) — Entrepreneur no incluye ninguno.
// 'plus' es alias de 'business': nombre viejo del mismo tier de $14,997 que
// dejaron algunas ofertas sembradas antes de que el frontend lo renombrara.
export const resolveWhatsappGroupUrl = (plan: string): string | null => {
  if (plan === 'business' || plan === 'plus') return env.whatsapp.businessGroupUrl || null;
  if (plan === 'master') return env.whatsapp.masterGroupUrl || null;
  return null;
};

// WhatsApp no ofrece links de invitacion de un solo uso — cualquiera con el
// link real puede entrar hasta que se resetea a mano. En su lugar se manda
// este link propio: la primera vez que se abre, resuelve al grupo real; a
// partir de ahi queda inutilizado, sin importar cuantas veces se reenvie.
export const issueWhatsappInviteToken = (plan: string): string | null => {
  if (!resolveWhatsappGroupUrl(plan)) return null;
  return randomUUID();
};

export const buildWhatsappInviteUrl = (token: string): string =>
  `${env.serverUrl}/api/v1/academia/whatsapp/${token}`;

export const redeemWhatsappInvite = async (
  token: string,
): Promise<{ status: 'ok'; url: string } | { status: 'invalid' | 'used' }> => {
  const sub = await Subscription.findOne({ whatsappInviteToken: token });
  if (!sub) return { status: 'invalid' };
  if (sub.whatsappInviteUsedAt) return { status: 'used' };

  const url = resolveWhatsappGroupUrl(sub.plan);
  if (!url) return { status: 'invalid' };

  await Subscription.findByIdAndUpdate(String((sub as ISubscriptionDocument)._id), {
    whatsappInviteUsedAt: new Date().toISOString(),
  } as Partial<ISubscriptionDocument>);

  return { status: 'ok', url };
};
