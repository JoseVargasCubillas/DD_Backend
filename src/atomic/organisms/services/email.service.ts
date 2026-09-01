import nodemailer from 'nodemailer';
import { env } from '../../../config/env.js';
import { IUserDocument } from '../../molecules/models/user.model.js';
import { IOrderDocument } from '../../molecules/models/order.model.js';

const ADMIN_NOTICE_EMAIL = 'Ti@diegodiaz.mx';

const transporter = nodemailer.createTransport({
  host: env.mail.host,
  port: env.mail.port,
  auth: { user: env.mail.user, pass: env.mail.pass },
});

const escapeHtml = (value: string): string =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// Envuelve la ultima palabra/frase de un titulo en cursiva, siguiendo el
// acento editorial que usa el resto del sitio (ver Academy/Checkout pages).
const accent = (text: string): string => `<span style="font-style:italic;">${escapeHtml(text)}</span>`;

const formatPlanName = (value: string): string =>
  String(value || '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const send = (to: string, subject: string, html: string): Promise<unknown> =>
  transporter.sendMail({
    from: env.mail.from || 'Diego Díaz <servicios@diegodiaz.mx>',
    replyTo: 'servicios@diegodiaz.mx',
    to,
    subject,
    html,
  });

interface MailAttachment {
  filename: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
}

const sendWithAttachments = (
  to: string,
  subject: string,
  html: string,
  attachments: MailAttachment[],
): Promise<unknown> =>
  transporter.sendMail({
    from: env.mail.from || 'Diego Díaz <servicios@diegodiaz.mx>',
    replyTo: 'servicios@diegodiaz.mx',
    to,
    subject,
    html,
    attachments,
  });

const emailShell = ({
  eyebrow,
  badge,
  title,
  lead,
  content,
  ctaLabel,
  ctaUrl,
  preheader,
  headerCta,
  footerMeta,
  footerNote,
}: {
  eyebrow: string;
  badge?: string;
  /** HTML de confianza (no se escapa) — usar `accent()` para la palabra final en cursiva. */
  title: string;
  lead: string;
  content: string;
  ctaLabel?: string;
  ctaUrl?: string;
  preheader?: string;
  headerCta?: { label: string; url: string };
  footerMeta?: { left: string; right: string };
  footerNote?: { tag: string; body: string };
}): string => `
  <!doctype html>
  <html>
    <body style="margin:0;background:#f3efe7;color:#15120f;font-family:Arial,Helvetica,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;">
        ${escapeHtml(preheader || lead)}
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3efe7;padding:34px 14px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;background:#fbf8f1;border:1px solid #ddd4c7;">
              <tr>
                <td style="padding:0;background:#0a0908;height:8px;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:30px 34px 26px;border-bottom:1px solid #e4dccf;background:#fbf8f1;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="vertical-align:middle;">
                        <div style="font-size:13px;letter-spacing:5px;text-transform:uppercase;color:#17130f;font-weight:700;">Diego Díaz</div>
                        <div style="margin-top:6px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#9f9588;">Estrategia Fiscal</div>
                      </td>
                      <td align="right" style="vertical-align:middle;">
                        ${headerCta
                          ? `<a href="${escapeHtml(headerCta.url)}" style="display:inline-block;border:1px solid #17130f;padding:9px 14px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#17130f;text-decoration:none;">${escapeHtml(headerCta.label)} &#8594;</a>`
                          : `<div style="display:inline-block;border:1px solid #cfc5b7;padding:9px 12px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#7e7468;">Academia</div>`}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background:#050505;color:#f7f1e8;padding:46px 34px 44px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="vertical-align:top;">
                        <table role="presentation" cellspacing="0" cellpadding="0">
                          <tr>
                            <td style="font-size:10px;letter-spacing:5px;text-transform:uppercase;color:#b6aa9a;">&#8212; ${escapeHtml(eyebrow)}</td>
                            ${badge
                              ? `<td style="padding-left:14px;"><span style="display:inline-block;border:1px solid #3a3530;padding:6px 12px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#c9e6c9;">&#9679; ${escapeHtml(badge)}</span></td>`
                              : ''}
                          </tr>
                        </table>
                        <h1 style="margin:18px 0 0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:48px;line-height:1.02;color:#f7f1e8;">${title}</h1>
                        <p style="margin:22px 0 0;max-width:560px;font-size:15px;line-height:1.7;color:#cfc4b6;">${escapeHtml(lead)}</p>
                      </td>
                    </tr>
                  </table>
                  ${ctaLabel && ctaUrl ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;margin-top:30px;background:#f7f1e8;color:#080706;text-decoration:none;padding:15px 22px;font-size:11px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;">${escapeHtml(ctaLabel)} &#8594;</a>` : ''}
                </td>
              </tr>
              <tr>
                <td style="padding:34px;">
                  ${content}
                </td>
              </tr>
              ${footerMeta
                ? `<tr>
                    <td style="padding:0 34px 22px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#a89e90;">${footerMeta.left}</td>
                          <td align="right" style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#a89e90;">${footerMeta.right}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>`
                : ''}
              <tr>
                <td style="padding:26px 34px;border-top:1px solid #e4dccf;background:#f6f1e8;color:#8b8175;font-size:12px;line-height:1.7;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#17130f;">El éxito ama la preparación.</td>
                      <td align="right" style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9c9286;">${footerNote ? escapeHtml(footerNote.tag) : '&#8212; Diego Díaz'}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding-top:12px;color:#8b8175;">
                        ${footerNote ? escapeHtml(footerNote.body) : 'Si necesitas apoyo, responde este correo o escribe a servicios@diegodiaz.mx.'}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

const detailRows = (rows: Array<[string, string]>): string => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #ded6ca;background:#fffdf8;">
    ${rows.map(([label, value]) => `
      <tr>
        <td style="width:34%;padding:16px 18px;border-bottom:1px solid #e8dfd3;color:#9b9185;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;">${escapeHtml(label)}</td>
        <td style="padding:16px 18px;border-bottom:1px solid #e8dfd3;color:#17130f;font-size:14px;font-weight:700;line-height:1.45;">${escapeHtml(value)}</td>
      </tr>
    `).join('')}
  </table>
`;

const formatMXN = (value: number): string =>
  `$${Math.round(value).toLocaleString('es-MX')} MXN`;

const amountBand = (label: string, value: string): string => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#17130f;margin-bottom:22px;">
    <tr>
      <td style="padding:20px 26px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#b6aa9a;">&#8212; ${escapeHtml(label)}</td>
      <td align="right" style="padding:20px 26px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#f7f1e8;">${escapeHtml(value)}</td>
    </tr>
  </table>
`;

const linkButton = ({
  label,
  detail,
  url,
  dark,
}: {
  label: string;
  detail?: string;
  url: string;
  dark?: boolean;
}): string => `
  <a href="${escapeHtml(url)}" style="display:block;text-decoration:none;margin-bottom:12px;background:${dark ? '#17130f' : '#fffdf8'};border:1px solid ${dark ? '#17130f' : '#ded6ca'};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding:18px 22px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${dark ? '#f7f1e8' : '#17130f'};">${escapeHtml(label)}</td>
        ${detail ? `<td align="right" style="padding:18px 22px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:${dark ? '#cfc4b6' : '#8b8175'};">${escapeHtml(detail)} &#8594;</td>` : ''}
      </tr>
    </table>
  </a>
`;

const confirmationPanel = ({
  label,
  tag,
  value,
  description,
  rows,
}: {
  label: string;
  tag?: string;
  /** HTML de confianza — usar `accent()` para resaltar parte del valor en cursiva. */
  value: string;
  description: string;
  rows: Array<[string, string]>;
}): string => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td style="padding:0 0 22px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#17130f;color:#f7f1e8;">
          <tr>
            <td style="padding:26px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b6aa9a;">&#8212; ${escapeHtml(label)}</td>
                  ${tag ? `<td align="right" style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:12px;color:#cfc4b6;">${escapeHtml(tag)}</td>` : ''}
                </tr>
              </table>
              <div style="margin-top:10px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.05;color:#f7f1e8;">${value}</div>
              <p style="margin:12px 0 0;color:#cfc4b6;font-size:14px;line-height:1.6;">${escapeHtml(description)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td>${detailRows(rows)}</td>
    </tr>
  </table>
`;

export const sendWelcome = (user: IUserDocument): Promise<unknown> =>
  send(user.email, 'Bienvenido a la Academia Diego Díaz', emailShell({
    eyebrow: 'Bienvenida',
    title: `Tu cuenta<br/>está ${accent('lista.')}`,
    lead: `Hola ${user.name}, gracias por unirte a la Academia Diego Díaz.`,
    content: '<p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">Explora tus cursos, sesiones y materiales desde tu cuenta.</p>',
    ctaLabel: 'Entrar a Academia',
    ctaUrl: env.clientUrl,
    preheader: 'Tu cuenta de Academia Diego Díaz está lista.',
  }));

export const sendCredentials = (
  user: { name: string; email: string },
  tempPassword: string,
  opts: { isNew: boolean },
): Promise<unknown> =>
  send(
    user.email,
    opts.isNew ? 'Acceso a la Academia Diego Díaz' : 'Tu nueva contraseña - Academia Diego Díaz',
    emailShell({
      eyebrow: opts.isNew ? 'Bienvenida · Alta de cuenta' : 'Seguridad',
      title: opts.isNew ? `Tu cuenta<br/>ya está ${accent('lista.')}` : `Contraseña<br/>${accent('actualizada.')}`,
      lead: opts.isNew
        ? `Hola ${user.name}, tu acceso a la Academia Diego Díaz ya está activo. Entra con las credenciales que te dejamos abajo.`
        : `Hola ${user.name}, restablecimos tu contraseña como lo solicitaste.`,
      content: `
        <div style="margin:0 0 14px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">&#8212; Acceso · Credenciales temporales</div>
        <p style="margin:0 0 20px;color:#5f574f;font-size:14px;line-height:1.7;">Usa estas credenciales para iniciar sesión. Te recomendamos cambiarla desde tu perfil al primer ingreso.</p>
        ${detailRows([
          ['Correo', user.email],
          [opts.isNew ? 'Contraseña temporal' : 'Nueva contraseña', tempPassword],
        ])}
      `,
      ctaLabel: 'Iniciar sesión',
      ctaUrl: `${env.clientUrl}/iniciar-sesion`,
      preheader: opts.isNew ? 'Tu cuenta de Academia Diego Díaz está lista.' : 'Tu contraseña fue actualizada.',
    }),
  );

export const sendMigrationWelcome = (
  user: { name: string; email: string },
  tempPassword: string,
): Promise<unknown> =>
  send(
    user.email,
    'Cambiamos de plataforma - Academia Diego Díaz',
    emailShell({
      eyebrow: 'Aviso importante',
      title: `Cambiamos<br/>de ${accent('plataforma.')}`,
      lead: `Hola ${user.name}, queremos recordarte que sigues suscrito a la Academia Diego Díaz. Acabamos de migrar a una nueva plataforma para mejorar tu experiencia.`,
      content: `
        <p style="margin:0 0 20px;color:#5f574f;font-size:14px;line-height:1.7;">Da clic en el botón de abajo para entrar a la nueva Academia e ingresa con la contraseña que te dejamos aquí. ¡Bienvenido de nuevo!</p>
        ${detailRows([
          ['Correo', user.email],
          ['Contraseña de acceso', tempPassword],
        ])}
      `,
      ctaLabel: 'Ir a la Academia',
      ctaUrl: `${env.clientUrl}/iniciar-sesion`,
      preheader: 'Migramos de plataforma. Ingresa con tu nueva contraseña y continúa tu formación.',
    }),
  );

export const sendPasswordReset = (user: IUserDocument, resetUrl: string): Promise<unknown> =>
  send(user.email, 'Restablecer contraseña', emailShell({
    eyebrow: 'Seguridad',
    title: `Restablece<br/>tu ${accent('contraseña.')}`,
    lead: 'Este enlace expira en 1 hora.',
    content: '<p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">Si no solicitaste este cambio, puedes ignorar este correo.</p>',
    ctaLabel: 'Restablecer',
    ctaUrl: resetUrl,
    preheader: 'Usa este enlace para restablecer tu contraseña.',
  }));

export const sendOrderConfirmation = (user: IUserDocument, order: IOrderDocument): Promise<unknown> =>
  send(user.email, 'Confirmación de compra', emailShell({
    eyebrow: 'Compra confirmada',
    title: `Tu compra<br/>fue ${accent('exitosa.')}`,
    lead: `Gracias, ${user.name}. Tu acceso está siendo preparado.`,
    content: detailRows([
      ['Total', `$${order.total} ${order.currency}`],
      ['Orden', String(order._id || order.id || '')],
    ]),
    ctaLabel: 'Ir a mi cuenta',
    ctaUrl: `${env.clientUrl}/mi-cuenta`,
    preheader: 'Tu compra fue confirmada correctamente.',
  }));

// Recibo de compra de un ticket de evento — mismo layout que
// sendAcademiaOrderReceipt, pero sin cuenta de por medio:
// no hay CTA de "ir a mi cuenta" ni credenciales, solo el comprobante.
export const sendEventOrderReceipt = (input: {
  name: string;
  email: string;
  order: IOrderDocument;
}): Promise<unknown> => {
  const { name, email, order } = input;
  const orderId = String(order._id || order.id || '');
  const ticketTitle = order.items.map((i) => i.title).join(', ');

  return send(email, 'Tu pago fue confirmado - Diego Díaz', emailShell({
    eyebrow: 'Compra confirmada',
    badge: 'Pagado',
    title: `Tu pago<br/>fue ${accent('confirmado.')}`,
    lead: `Hola ${name}, gracias por tu compra.`,
    content: `
      ${amountBand('Monto pagado', formatMXN(order.total))}
      ${confirmationPanel({
        label: 'Compra confirmada',
        tag: 'Ticket · pago único',
        value: accent(ticketTitle),
        description: 'Tu lugar quedó reservado. Conserva esta información como referencia de tu compra.',
        rows: [
          ['Evento', ticketTitle],
          ['Correo', email],
          ['Monto', formatMXN(order.total)],
          ...(order.shippingCarrier ? [['Paquetería', order.shippingCarrier.toUpperCase()] as [string, string]] : []),
          ...(order.shippingTrackingNumber ? [['Número de guía', order.shippingTrackingNumber] as [string, string]] : []),
          ['Referencia', order.stripePaymentIntentId || orderId],
        ],
      })}
      <div style="margin-top:22px;">
        ${order.shippingTrackUrl
          ? linkButton({ label: 'Rastrear envío', detail: order.shippingTrackingNumber, url: order.shippingTrackUrl, dark: true })
          : ''}
        ${linkButton({ label: 'Ver recibo', detail: orderId.slice(0, 10) + '…', url: `${env.clientUrl}/recibo/pedido/${orderId}`, dark: !order.shippingTrackUrl })}
      </div>
    `,
    footerMeta: {
      left: `Orden #${orderId.slice(-8).toUpperCase()}`,
      right: formatDateTimeEs(new Date()),
    },
    preheader: 'Tu pago fue confirmado correctamente.',
  }));
};

const formatDateEs = (date: Date): string =>
  new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).format(date);

const formatDateTimeEs = (date: Date): string =>
  `${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }).format(date)} CDMX`;

// Academia ya no crea Subscriptions de Stripe (ver grantAcademiaAccess en
// payment.service.ts) — el pago es un Order de un solo cobro y la renovacion
// es manual, por eso ya no hay cardLabel/nextChargeAt de Stripe Billing:
// en su lugar se muestra accessUntil, la fecha hasta la que queda el acceso.
export const sendAcademiaOrderNotice = (input: {
  orderId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  plan: string;
  amountPaid: number;
  accessUntil: Date;
  receiptUrl: string;
  isRenewal?: boolean;
}): Promise<unknown> =>
  send(
    ADMIN_NOTICE_EMAIL,
    input.isRenewal ? 'Renovación de Academia Diego Díaz' : 'Nueva compra confirmada en Academia Diego Díaz',
    emailShell({
      eyebrow: input.isRenewal ? 'Renovación confirmada' : 'Compra confirmada',
      badge: 'Pagado',
      title: input.isRenewal ? `Renovación<br/>${accent('confirmada.')}` : `Nueva compra<br/>${accent('confirmada.')}`,
      lead: input.isRenewal
        ? 'Un cliente renovó manualmente su acceso a Academia+. Los datos del cliente y la referencia interna están abajo.'
        : 'Se confirmó el pago de un nuevo acceso a Academia+. Los datos del cliente y la referencia interna están abajo, listos para seguimiento administrativo.',
      headerCta: { label: 'Ir a admin', url: `${env.clientUrl}/admin` },
      content: `
      ${input.amountPaid ? amountBand(input.isRenewal ? 'Monto renovado' : 'Monto cobrado', formatMXN(input.amountPaid)) : ''}
      ${confirmationPanel({
        label: input.isRenewal ? 'Renovación registrada' : 'Venta registrada',
        tag: 'Academia+ · acceso 1 año',
        value: `Plan ${accent(formatPlanName(input.plan))}`,
        description: input.isRenewal
          ? 'Datos del cliente y referencia de la orden para seguimiento administrativo. Es una renovación manual de un acceso ya existente.'
          : 'Datos del cliente y referencia de la orden para seguimiento administrativo. El cliente ya recibió su correo de acceso al portal.',
        rows: [
          ['Plan', formatPlanName(input.plan)],
          ['Nombre', input.customerName],
          ['Correo', input.customerEmail],
          ['Teléfono', input.customerPhone],
          ...(input.amountPaid ? [['Monto', formatMXN(input.amountPaid)] as [string, string]] : []),
          ['Acceso vigente hasta', formatDateEs(input.accessUntil)],
        ],
      })}
      <div style="margin-top:22px;">
        ${input.receiptUrl ? linkButton({ label: 'Ver recibo', detail: `Orden #${input.orderId.slice(-8).toUpperCase()}`, url: input.receiptUrl, dark: true }) : ''}
        ${linkButton({ label: 'Ir al contacto', detail: input.customerName, url: `${env.clientUrl}/admin/contactos/${input.customerId}`, dark: false })}
      </div>
    `,
      footerMeta: {
        left: `Orden #${input.orderId.slice(-8).toUpperCase()}`,
        right: formatDateTimeEs(new Date()),
      },
      footerNote: {
        tag: '— Notificación administrativa',
        body: `diegodiaz.mx · Academia — enviado a ${ADMIN_NOTICE_EMAIL.toLowerCase()}. Este correo es interno y no contiene datos sensibles del pago.`,
      },
      preheader: input.isRenewal
        ? `Renovación confirmada: ${formatPlanName(input.plan)}.`
        : `Nueva compra confirmada: ${formatPlanName(input.plan)}.`,
    }),
  );

export const sendAcademiaOrderReceipt = (input: {
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  plan: string;
  amountPaid: number;
  accessUntil: Date;
  receiptUrl: string;
  isRenewal?: boolean;
}): Promise<unknown> =>
  send(
    input.customerEmail,
    input.isRenewal ? 'Tu acceso a Academia se renovó - Academia Diego Díaz' : 'Tu pago fue confirmado - Academia Diego Díaz',
    emailShell({
      eyebrow: input.isRenewal ? 'Renovación confirmada' : 'Compra confirmada',
      badge: 'Pagado',
      title: input.isRenewal ? `Tu acceso<br/>se ${accent('renovó.')}` : `Tu pago<br/>fue ${accent('confirmado.')}`,
      lead: input.isRenewal
        ? `Hola ${input.customerName}, renovaste tu acceso a Academia Diego Díaz por un año más.`
        : `Hola ${input.customerName}, gracias por unirte a Academia Diego Díaz.`,
      content: `
      ${input.amountPaid ? amountBand(input.isRenewal ? 'Monto renovado' : 'Monto pagado', formatMXN(input.amountPaid)) : ''}
      ${confirmationPanel({
        label: input.isRenewal ? 'Renovación confirmada' : 'Acceso confirmado',
        tag: 'Academia+ · acceso 1 año',
        value: accent(formatPlanName(input.plan)),
        description: `Tu acceso queda activo hasta el ${formatDateEs(input.accessUntil)}. La renovación es manual — te avisaremos por correo antes de que se venza.`,
        rows: [
          ['Plan', formatPlanName(input.plan)],
          ['Correo', input.customerEmail],
          ['Teléfono', input.customerPhone],
          ...(input.amountPaid ? [['Monto', formatMXN(input.amountPaid)] as [string, string]] : []),
          ['Acceso vigente hasta', formatDateEs(input.accessUntil)],
        ],
      })}
      <div style="margin-top:22px;">
        ${input.receiptUrl ? linkButton({ label: 'Ver recibo', detail: `Orden #${input.orderId.slice(-8).toUpperCase()}`, url: input.receiptUrl, dark: true }) : ''}
      </div>
    `,
      ctaLabel: 'Entrar a Academia',
      ctaUrl: `${env.clientUrl}/academia`,
      footerMeta: {
        left: `Orden #${input.orderId.slice(-8).toUpperCase()}`,
        right: formatDateTimeEs(new Date()),
      },
      preheader: input.isRenewal
        ? `Tu acceso a Academia ${formatPlanName(input.plan)} se renovó.`
        : `Tu pago de Academia ${formatPlanName(input.plan)} fue confirmado.`,
    }),
  );

// Recordatorio antes del vencimiento — mismo texto para la ventana de 7 dias
// y la de 1 dia/dia-de, solo cambia la urgencia del copy segun daysLeft.
export const sendAcademiaRenewalReminder = (input: {
  name: string;
  email: string;
  offerTitle: string;
  expiresAt: Date;
  daysLeft: number;
  renewUrl: string;
}): Promise<unknown> => {
  const urgent = input.daysLeft <= 1;
  const whenText = input.daysLeft <= 0 ? 'hoy' : input.daysLeft === 1 ? 'mañana' : `en ${input.daysLeft} días`;
  return send(
    input.email,
    urgent ? `Tu acceso a Academia vence ${whenText}` : `Tu acceso a Academia vence en ${input.daysLeft} días`,
    emailShell({
      eyebrow: 'Recordatorio de renovación',
      badge: urgent ? 'Vence pronto' : 'Recordatorio',
      title: `Tu acceso vence<br/>${accent(whenText + '.')}`,
      lead: `Hola ${input.name}, tu acceso a ${input.offerTitle} vence ${whenText}. Renueva para no perder el acceso a tus cursos.`,
      content: `
      ${confirmationPanel({
        label: 'Acceso por vencer',
        tag: 'Academia+',
        value: accent(input.offerTitle),
        description: 'La renovación es manual: si no renuevas antes de la fecha, tu acceso a los cursos se corta automáticamente.',
        rows: [
          ['Oferta', input.offerTitle],
          ['Vence el', formatDateEs(input.expiresAt)],
        ],
      })}
    `,
      ctaLabel: 'Renovar ahora',
      ctaUrl: input.renewUrl,
      preheader: `Tu acceso a ${input.offerTitle} vence ${whenText}.`,
    }),
  );
};

export const sendAcademiaExpiredNotice = (input: {
  name: string;
  email: string;
  offerTitle: string;
  renewUrl: string;
}): Promise<unknown> =>
  send(
    input.email,
    'Tu acceso a Academia venció',
    emailShell({
      eyebrow: 'Acceso vencido',
      title: `Tu acceso<br/>${accent('venció.')}`,
      lead: `Hola ${input.name}, tu acceso a ${input.offerTitle} venció y tus cursos quedaron bloqueados. Renueva cuando quieras para recuperarlo.`,
      content: `
      ${confirmationPanel({
        label: 'Acceso vencido',
        tag: 'Academia+',
        value: accent(input.offerTitle),
        description: 'Tu progreso se conserva — al renovar recuperas el acceso donde lo dejaste.',
        rows: [['Oferta', input.offerTitle]],
      })}
    `,
      ctaLabel: 'Renovar ahora',
      ctaUrl: input.renewUrl,
      preheader: `Tu acceso a ${input.offerTitle} venció.`,
    }),
  );

export const sendGuideEmail = (
  input: { email: string; name?: string; guidePath: string; guideFilename: string },
): Promise<unknown> =>
  sendWithAttachments(
    input.email,
    'Tu guía para blindarte del SAT — Diego Díaz',
    emailShell({
      eyebrow: 'Guía · Regalo editorial',
      badge: 'PDF · 2026',
      title: `Aquí está tu guía<br/>para blindarte del ${accent('SAT.')}`,
      lead: input.name
        ? `Hola ${input.name}, aquí tienes tu ejemplar en PDF. Puedes descargarlo desde el adjunto de este mismo correo.`
        : 'Aquí tienes tu ejemplar en PDF. Puedes descargarlo desde el adjunto de este mismo correo.',
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Esta guía reúne los criterios que trabajamos con clientes de Díaz Lara Consultoría para anticipar auditorías, ordenar la contabilidad y sostener una defensa fiscal sólida.
        </p>
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Si quieres profundizar en un caso propio, responde a este correo y te acompañamos desde el despacho.
        </p>
        <div style="margin:0 0 8px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">— Cómo abrir el material</div>
        <p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">
          Descarga el archivo adjunto (${escapeHtml(input.guideFilename)}) y guárdalo en tu ordenador. Si tu cliente de correo bloquea adjuntos grandes, escríbenos y te enviamos un enlace directo.
        </p>
      `,
      ctaLabel: 'Conocer la Academia',
      ctaUrl: `${env.clientUrl}/academia`,
      preheader: 'Adjuntamos tu guía en PDF para blindarte del SAT.',
    }),
    [
      {
        filename: input.guideFilename,
        path: input.guidePath,
        contentType: 'application/pdf',
      },
    ],
  );

export const sendMediaKitEmail = (
  input: { email: string; name?: string; downloadUrl: string },
): Promise<unknown> =>
  send(
    input.email,
    'Media kit de Diego Díaz',
    emailShell({
      eyebrow: 'Kit editorial · Prensa',
      badge: 'PDF · 2026',
      title: `Tu descarga del<br/>Media Kit ${accent('Diego Díaz.')}`,
      lead: input.name
        ? `Hola ${input.name}, aquí tienes el enlace de descarga del media kit oficial (bio, fotografías en alta, logotipos y líneas editoriales).`
        : 'Aquí tienes el enlace de descarga del media kit oficial (bio, fotografías en alta, logotipos y líneas editoriales).',
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          El archivo pesa cerca de 75 MB, por eso lo enviamos como enlace en lugar de adjunto. Descárgalo desde el botón, guárdalo y úsalo para tu publicación, entrevista o colaboración.
        </p>
        <div style="margin:22px 0 8px;">
          ${linkButton({ label: 'Descargar Media Kit (PDF)', detail: '≈ 75 MB · ESP/ENG', url: input.downloadUrl, dark: true })}
        </div>
        <p style="margin:20px 0 0;color:#5f574f;font-size:14px;line-height:1.7;">
          Si necesitas fotografías adicionales, una entrevista o preparar una nota de prensa, responde a este correo y te contactamos.
        </p>
      `,
      ctaLabel: 'Conocer más de Diego',
      ctaUrl: `${env.clientUrl}/diego-diaz`,
      preheader: 'Descarga el media kit oficial de Diego Díaz.',
    }),
  );

export const sendEstrategiaFiscalDossierEmail = (
  input: {
    email: string;
    name?: string;
    phone?: string;
    dossierPath: string;
    dossierFilename: string;
  },
): Promise<unknown> =>
  sendWithAttachments(
    input.email,
    'Tu dossier del Seminario Estrategia Fiscal — Diego Díaz',
    emailShell({
      eyebrow: 'Dossier · Estrategia Fiscal',
      badge: 'PDF · Seminario',
      title: `Aquí está tu dossier<br/>de Estrategia ${accent('Fiscal.')}`,
      lead: input.name
        ? `Hola ${input.name}, adjuntamos el dossier oficial del Seminario de Estrategia Fiscal.`
        : 'Adjuntamos el dossier oficial del Seminario de Estrategia Fiscal.',
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          En este material encontrarás la información base del seminario, el enfoque de trabajo y los puntos clave para decidir si esta edición encaja con el momento fiscal de tu empresa.
        </p>
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Guardamos tus datos para poder dar seguimiento a tu solicitud del dossier. Si quieres reservar tu lugar, responde este correo y el equipo te orienta.
        </p>
        ${detailRows([
          ['Recurso', input.dossierFilename],
          ['Correo', input.email],
          ...(input.phone ? [['Teléfono', input.phone] as [string, string]] : []),
        ])}
      `,
      ctaLabel: 'Ver calendario',
      ctaUrl: `${env.clientUrl}/eventos`,
      preheader: 'Adjuntamos tu dossier del Seminario de Estrategia Fiscal.',
    }),
    [
      {
        filename: input.dossierFilename,
        path: input.dossierPath,
        contentType: 'application/pdf',
      },
    ],
  );

export const sendDownloadableResourceEmail = (
  input: { email: string; name?: string; resourceTitle: string; downloadUrl: string },
): Promise<unknown> =>
  send(
    input.email,
    `${input.resourceTitle} — Centro de Recursos Diego Díaz`,
    emailShell({
      eyebrow: 'Centro de Recursos · Descarga',
      badge: 'PDF',
      title: `Tu recurso está<br/>listo para ${accent('descargar.')}`,
      lead: input.name
        ? `Hola ${input.name}, aquí tienes el enlace para descargar "${input.resourceTitle}".`
        : `Aquí tienes el enlace para descargar "${input.resourceTitle}".`,
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Guardamos tu solicitud para poder enviarte actualizaciones relevantes sobre recursos fiscales, guías y herramientas de Diego Díaz.
        </p>
        <div style="margin:22px 0 8px;">
          ${linkButton({ label: 'Descargar recurso', detail: escapeHtml(input.resourceTitle), url: input.downloadUrl, dark: true })}
        </div>
        <p style="margin:20px 0 0;color:#5f574f;font-size:14px;line-height:1.7;">
          Si el botón no abre, copia y pega este enlace en tu navegador:<br/>
          <span style="word-break:break-all;color:#111;">${escapeHtml(input.downloadUrl)}</span>
        </p>
      `,
      ctaLabel: 'Ver más recursos',
      ctaUrl: `${env.clientUrl}/recursos`,
      preheader: `Descarga ${input.resourceTitle} desde el Centro de Recursos.`,
    }),
  );


