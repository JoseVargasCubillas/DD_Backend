import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';
import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';
import { Package, IPackageDocument } from '../../molecules/models/package.model.js';

// Solo los planes Business y Master traen grupo de WhatsApp (ver plansFallback
// en Academy/index.tsx del frontend) — Entrepreneur no incluye ninguno.
// 'plus' es alias de 'business': nombre viejo del mismo tier de $14,997 que
// dejaron algunas ofertas sembradas antes de que el frontend lo renombrara.
export const resolveWhatsappGroupUrl = (plan: string): string | null => {
  const key = String(plan || '').toLowerCase();
  if (key === 'business' || key === 'plus') return env.whatsapp.businessGroupUrl || null;
  if (key === 'master') return env.whatsapp.masterGroupUrl || null;
  return null;
};

const GROUP_URL_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?(\?.*)?$/;

// Grupo de un paquete: primero el enlace propio guardado en sus beneficios
// (admin → Paquetes → "Grupo de WhatsApp con asesores"; así funciona Élite Privé),
// luego el del .env según su tier y, al final, según su slug.
export const resolvePackageWhatsappGroupUrl = (pkg: Pick<IPackageDocument, 'tier' | 'slug' | 'benefits'> | null | undefined): string | null => {
  if (!pkg) return null;
  const group = (pkg.benefits as Record<string, unknown> | undefined)?.whatsappGroupAdvisors as
    | { enabled?: boolean; url?: string }
    | undefined;
  if (group && group.enabled !== false) {
    const url = String(group.url || '').trim();
    if (GROUP_URL_RE.test(url)) return url;
  }
  return resolveWhatsappGroupUrl(String(pkg.tier || '')) ?? resolveWhatsappGroupUrl(String(pkg.slug || ''));
};

// WhatsApp no ofrece links de invitacion de un solo uso — cualquiera con el
// link real puede entrar hasta que se resetea a mano. En su lugar se manda
// este link propio: la primera vez que se abre, resuelve al grupo real; a
// partir de ahi queda inutilizado, sin importar cuantas veces se reenvie.
export const issueWhatsappInviteToken = (plan: string): string | null => {
  if (!resolveWhatsappGroupUrl(plan)) return null;
  return randomUUID();
};

export const issueWhatsappInviteTokenForPackage = (pkg: IPackageDocument): string | null => {
  if (!resolvePackageWhatsappGroupUrl(pkg)) return null;
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

  // Suscripciones asignadas desde el admin guardan packageId: el grupo sale del
  // paquete (p. ej. el propio de Élite Privé). Las de Stripe se resuelven por plan.
  const pkg = sub.packageId ? await Package.findById(String(sub.packageId)) : null;
  const url = resolvePackageWhatsappGroupUrl(pkg) ?? resolveWhatsappGroupUrl(sub.plan);
  if (!url) return { status: 'invalid' };

  await Subscription.findByIdAndUpdate(String((sub as ISubscriptionDocument)._id), {
    whatsappInviteUsedAt: new Date().toISOString(),
  } as Partial<ISubscriptionDocument>);

  return { status: 'ok', url };
};
