import nodemailer from 'nodemailer';
import { env } from '../../../config/env.js';
import { IUserDocument } from '../../molecules/models/user.model.js';
import { IOrderDocument } from '../../molecules/models/order.model.js';
import { formatTicketOrderRef } from '../../atoms/helpers/event-ticket.helper.js';

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
  // Content-ID para imágenes inline (<img src="cid:...">).
  cid?: string;
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
  heroImage,
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
  /** URL absoluta a un banner (JPG/PNG) mostrado entre el header y el hero oscuro. */
  heroImage?: { url: string; alt: string };
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
              ${heroImage
                ? `<tr>
                    <td style="padding:0;background:#050505;font-size:0;line-height:0;">
                      <img src="${escapeHtml(heroImage.url)}" alt="${escapeHtml(heroImage.alt)}" width="720" style="display:block;width:100%;max-width:720px;height:auto;border:0;outline:none;text-decoration:none;" />
                    </td>
                  </tr>`
                : ''}
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

// Tarjeta de boleto para el correo: QR inline (cid) + folio + datos del
// asistente, con línea troquelada que separa el talón. Diseñada para que se
// vea bien en móvil y al imprimir.
export interface ReceiptTicketCard {
  folio: string;
  attendeeName: string;
  eventTitle: string;
  eventDate: string;
  eventFormat: string;
  amount: number;
  seatIndex: number;
  seatTotal: number;
  purchasedAt: Date | string;
  url: string;
  qrCid: string;
}

const ticketCard = (t: ReceiptTicketCard, orderRef: string): string => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border:1px solid #ded6ca;background:#fffdf8;">
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#17130f;">
          <tr>
            <td style="padding:16px 22px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b6aa9a;">&#8212; Boleto de acceso${t.seatTotal > 1 ? ` · ${t.seatIndex} de ${t.seatTotal}` : ''}</td>
            <td align="right" style="padding:16px 22px;font-family:'Courier New',Courier,monospace;font-size:13px;letter-spacing:2px;color:#f7f1e8;">${escapeHtml(t.folio)}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td valign="top" style="padding:22px 22px 18px;">
              <div style="font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">Asistente</div>
              <div style="margin:4px 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.15;color:#17130f;">${escapeHtml(t.attendeeName)}</div>
              <div style="font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">Evento</div>
              <div style="margin:4px 0 12px;font-size:14px;font-weight:700;line-height:1.4;color:#17130f;">${escapeHtml(t.eventTitle)}</div>
              <table role="presentation" cellspacing="0" cellpadding="0">
                ${t.eventDate ? `<tr><td style="padding:0 18px 8px 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9b9185;">Fecha</td><td style="padding:0 0 8px;font-size:13px;color:#17130f;">${escapeHtml(t.eventDate)}</td></tr>` : ''}
                ${t.eventFormat ? `<tr><td style="padding:0 18px 8px 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9b9185;">Formato</td><td style="padding:0 0 8px;font-size:13px;color:#17130f;">${escapeHtml(t.eventFormat)}</td></tr>` : ''}
                <tr><td style="padding:0 18px 8px 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9b9185;">Compra</td><td style="padding:0 0 8px;font-size:13px;color:#17130f;">${escapeHtml(formatDateTimeEs(t.purchasedAt))}</td></tr>
                <tr><td style="padding:0 18px 8px 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9b9185;">Monto</td><td style="padding:0 0 8px;font-size:13px;font-weight:700;color:#17130f;">${escapeHtml(formatMXN(t.amount))}</td></tr>
                <tr><td style="padding:0 18px 0 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9b9185;">Orden</td><td style="font-size:12px;color:#5f574f;">${escapeHtml(orderRef)}</td></tr>
              </table>
            </td>
            <td valign="middle" width="190" style="padding:18px 20px;border-left:2px dashed #ded6ca;text-align:center;background:#f7f2ea;">
              <img src="cid:${escapeHtml(t.qrCid)}" width="150" height="150" alt="QR ${escapeHtml(t.folio)}" style="display:block;margin:0 auto;width:150px;height:150px;background:#ffffff;padding:6px;border:1px solid #ded6ca;" />
              <div style="margin-top:10px;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#9b9185;line-height:1.5;">Escanear en<br/>la entrada</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0;">
        <a href="${escapeHtml(t.url)}" style="display:block;text-decoration:none;background:#fffdf8;border-top:1px solid #ded6ca;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding:14px 22px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#17130f;">Ver mi boleto</td>
              <td align="right" style="padding:14px 22px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#8b8175;">guardar o imprimir &#8594;</td>
            </tr>
          </table>
        </a>
      </td>
    </tr>
  </table>
`;

// Recibo de compra de un ticket de evento — mismo layout que
// sendAcademiaOrderReceipt, pero sin cuenta de por medio:
// no hay CTA de "ir a mi cuenta" ni credenciales, solo el comprobante.
// Si la orden generó boletos, cada uno va como tarjeta con su QR inline.
export const sendEventOrderReceipt = (input: {
  name: string;
  email: string;
  order: IOrderDocument;
  tickets?: Array<ReceiptTicketCard & { qrPng: Buffer }>;
}): Promise<unknown> => {
  const { name, email, order, tickets = [] } = input;
  const orderId = String(order._id || order.id || '');
  const ticketTitle = order.items.map((i) => i.title).join(', ');
  const eventFormat = order.items.map((i) => i.eventFormat).filter(Boolean).join(', ');
  const eventDate = order.items.map((i) => i.eventDate).filter(Boolean).join(', ');
  const orderRef = order.stripePaymentIntentId || orderId;
  const hasTickets = tickets.length > 0;

  const html = emailShell({
    eyebrow: 'Compra confirmada',
    badge: 'Pagado',
    title: hasTickets ? `Tu lugar está<br/>${accent('confirmado.')}` : `Tu pago<br/>fue ${accent('confirmado.')}`,
    lead: hasTickets
      ? `Hola ${name}, gracias por tu compra. ${tickets.length === 1 ? 'Este es tu boleto' : `Estos son tus ${tickets.length} boletos`} de acceso: presenta el código QR en la entrada del evento.`
      : `Hola ${name}, gracias por tu compra.`,
    content: `
      ${amountBand('Monto pagado', formatMXN(order.total))}
      ${hasTickets ? `
        <div style="margin:0 0 14px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">&#8212; ${tickets.length === 1 ? 'Tu boleto' : 'Tus boletos'}</div>
        ${tickets.map((t) => ticketCard(t, formatTicketOrderRef(orderId))).join('')}
      ` : ''}
      ${confirmationPanel({
        label: 'Compra confirmada',
        tag: 'Ticket · pago único',
        value: accent(ticketTitle),
        description: hasTickets
          ? 'Tu lugar quedó reservado. El QR de cada boleto es único e intransferible; también puedes abrirlo desde el enlace "Ver mi boleto".'
          : 'Tu lugar quedó reservado. Conserva esta información como referencia de tu compra.',
        rows: [
          ['Evento', ticketTitle],
          ...(eventFormat ? [['Formato', eventFormat] as [string, string]] : []),
          ...(eventDate ? [['Fecha', eventDate] as [string, string]] : []),
          ['Correo', email],
          ['Monto', formatMXN(order.total)],
          ...(order.shippingCarrier ? [['Paquetería', order.shippingCarrier.toUpperCase()] as [string, string]] : []),
          ...(order.shippingTrackingNumber ? [['Número de guía', order.shippingTrackingNumber] as [string, string]] : []),
          ['Referencia', orderRef],
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
    preheader: hasTickets ? 'Tu boleto con QR de acceso está listo.' : 'Tu pago fue confirmado correctamente.',
  });

  const subject = hasTickets ? 'Tu boleto de acceso - Diego Díaz' : 'Tu pago fue confirmado - Diego Díaz';
  if (!hasTickets) return send(email, subject, html);
  return sendWithAttachments(
    email,
    subject,
    html,
    tickets.map((t) => ({
      filename: `boleto-${t.folio}.png`,
      content: t.qrPng,
      contentType: 'image/png',
      cid: t.qrCid,
    })),
  );
};

// Boletos de una venta cerrada por un asesor (negocio ganado en HubSpot): mismo
// layout de tarjeta con QR que el recibo de la página, pero sin orden de Stripe
// ni enlace a "Ver recibo".
export const sendEventTicketsEmail = (input: {
  name: string;
  email: string;
  reference: string;
  tickets: Array<ReceiptTicketCard & { qrPng: Buffer }>;
}): Promise<unknown> => {
  const { name, email, reference, tickets } = input;
  const html = emailShell({
    eyebrow: 'Registro confirmado',
    badge: 'Confirmado',
    title: `Tu lugar está<br/>${accent('confirmado.')}`,
    lead: `Hola ${name}, gracias por tu compra. ${tickets.length === 1 ? 'Este es tu boleto' : `Estos son tus ${tickets.length} boletos`} de acceso: presenta el código QR en la entrada del evento.`,
    content: `
      <div style="margin:0 0 14px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">&#8212; ${tickets.length === 1 ? 'Tu boleto' : 'Tus boletos'}</div>
      ${tickets.map((t) => ticketCard(t, reference)).join('')}
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#5f574f;">El QR de cada boleto es único e intransferible; también puedes abrirlo desde el enlace "Ver mi boleto".</p>
    `,
    footerMeta: { left: `Ref. ${reference}`, right: formatDateTimeEs(new Date()) },
    preheader: 'Tu boleto con QR de acceso está listo.',
  });
  return sendWithAttachments(
    email,
    'Tu boleto de acceso - Diego Díaz',
    html,
    tickets.map((t) => ({
      filename: `boleto-${t.folio}.png`,
      content: t.qrPng,
      contentType: 'image/png',
      cid: t.qrCid,
    })),
  );
};

// Aviso interno para CUALQUIER compra que no sea de Academia (libros,
// eventos, cursos sueltos) — Academia ya tiene el suyo propio, mas detallado,
// en sendAcademiaOrderNotice (grantAcademiaAccess llama a ese en vez de este).
export const sendOrderAdminNotice = (input: {
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  itemsTitle: string;
  eventFormat?: string;
  eventDate?: string;
  amountPaid: number;
  receiptUrl: string;
}): Promise<unknown> =>
  send(
    ADMIN_NOTICE_EMAIL,
    'Nueva compra confirmada en diegodiaz.mx',
    emailShell({
      eyebrow: 'Compra confirmada',
      badge: 'Pagado',
      title: `Nueva compra<br/>${accent('confirmada.')}`,
      lead: 'Se confirmó un pago en el sitio. Los datos del cliente y la referencia interna están abajo, listos para seguimiento administrativo.',
      headerCta: { label: 'Ir a admin', url: `${env.clientUrl}/admin` },
      content: `
      ${amountBand('Monto cobrado', formatMXN(input.amountPaid))}
      ${confirmationPanel({
        label: 'Venta registrada',
        tag: 'Pago único',
        value: accent(input.itemsTitle),
        description: 'Datos del cliente y referencia de la orden para seguimiento administrativo.',
        rows: [
          ['Producto', input.itemsTitle],
          ...(input.eventFormat ? [['Formato', input.eventFormat] as [string, string]] : []),
          ...(input.eventDate ? [['Fecha', input.eventDate] as [string, string]] : []),
          ['Nombre', input.customerName],
          ['Correo', input.customerEmail],
          ['Teléfono', input.customerPhone || '—'],
          ['Monto', formatMXN(input.amountPaid)],
        ],
      })}
      <div style="margin-top:22px;">
        ${input.receiptUrl ? linkButton({ label: 'Ver recibo', detail: `Orden #${input.orderId.slice(-8).toUpperCase()}`, url: input.receiptUrl, dark: true }) : ''}
      </div>
    `,
      footerMeta: {
        left: `Orden #${input.orderId.slice(-8).toUpperCase()}`,
        right: formatDateTimeEs(new Date()),
      },
      footerNote: {
        tag: '— Notificación administrativa',
        body: `diegodiaz.mx · enviado a ${ADMIN_NOTICE_EMAIL.toLowerCase()}. Este correo es interno y no contiene datos sensibles del pago.`,
      },
      preheader: `Nueva compra confirmada: ${input.itemsTitle}.`,
    }),
  );

const formatDateEs = (date: Date): string =>
  new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).format(date);

const formatDateTimeEs = (value: Date | string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }).format(date)} CDMX`;
};

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
  whatsappJoinUrl?: string;
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
      ${input.whatsappJoinUrl
        ? `<div style="margin-top:22px;padding:20px 22px;border:1px solid #25D366;background:#f0fbf4;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#17130f;">Tu plan incluye grupo de WhatsApp</p>
            <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#5f574f;">Este enlace es de un solo uso y personal — no lo compartas, deja de funcionar en cuanto entras al grupo.</p>
            ${linkButton({ label: 'Unirme al grupo de WhatsApp', url: input.whatsappJoinUrl, dark: false })}
          </div>`
        : ''}
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

export const sendNewsletterWelcomeEmail = (
  input: { email: string; name?: string },
): Promise<unknown> =>
  send(
    input.email,
    'Bienvenido a Diego Díaz',
    emailShell({
      eyebrow: 'Bienvenida · Newsletter',
      title: `Bienvenido a<br/>${accent('Diego Díaz.')}`,
      lead: input.name
        ? `Hola ${input.name}, bienvenido a Diego Díaz. Aquí recibirás actualizaciones y avisos de próximos eventos.`
        : 'Bienvenido a Diego Díaz. Aquí recibirás actualizaciones y avisos de próximos eventos.',
      content: `
        <p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">
          De vez en cuando te escribiremos con contenido editorial, guías fiscales y las próximas fechas de nuestros eventos y seminarios.
        </p>
      `,
      ctaLabel: 'Ver próximos eventos',
      ctaUrl: `${env.clientUrl}/eventos`,
      preheader: 'Aquí recibirás actualizaciones y avisos de próximos eventos.',
    }),
  );

export const sendGuideEmail = (
  input: { email: string; name?: string; guidePath: string; guideFilename: string },
): Promise<unknown> =>
  sendWithAttachments(
    input.email,
    'Iniciativa Fiscal 2027: 15 cambios que ya debes tener en el radar — Diego Díaz',
    emailShell({
      eyebrow: 'Documento · Regalo editorial',
      badge: 'PDF · Iniciativa 2027',
      title: `Iniciativa Fiscal 2027:<br/>15 cambios que ya debes<br/>tener en el ${accent('radar.')}`,
      lead: input.name
        ? `Hola ${input.name}, aquí tienes tu ejemplar en PDF. Puedes descargarlo desde el adjunto de este mismo correo.`
        : 'Aquí tienes tu ejemplar en PDF. Puedes descargarlo desde el adjunto de este mismo correo.',
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          En este documento repasamos los 15 cambios más relevantes de la Iniciativa Fiscal 2027 —RESICO, deducciones, pérdidas fiscales y más— para que tú y tu equipo lleguen preparados a la próxima temporada.
        </p>
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Si quieres profundizar en cómo impactan a tu caso, responde a este correo y te acompañamos desde el despacho.
        </p>
        <div style="margin:0 0 8px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">— Cómo abrir el material</div>
        <p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">
          Descarga el archivo adjunto (${escapeHtml(input.guideFilename)}) y guárdalo en tu ordenador. Si tu cliente de correo bloquea adjuntos grandes, escríbenos y te enviamos un enlace directo.
        </p>
      `,
      ctaLabel: 'Conocer la Academia',
      ctaUrl: `${env.clientUrl}/academia`,
      preheader: 'Adjuntamos tu documento en PDF de la Iniciativa Fiscal 2027.',
    }),
    [
      {
        filename: input.guideFilename,
        path: input.guidePath,
        contentType: 'application/pdf',
      },
    ],
  );

export const sendHoldingOfferEmail = (
  input: {
    email: string;
    name?: string;
    contextLine: string;
    stripeUrl: string;
    offerPrice: number;
    regularPrice: number;
    eventDateLabel: string;
    deadlineLabel: string;
  },
): Promise<unknown> => {
  const firstName = String(input.name || '').trim().split(/\s+/)[0] || '';
  const salute = firstName ? `${firstName},` : 'Hola,';
  const offer = input.offerPrice.toLocaleString('es-MX');
  const regular = input.regularPrice.toLocaleString('es-MX');
  return send(
    input.email,
    `Oferta exclusiva, solo HOY $${offer} (expira a las 11:59 PM)`,
    emailShell({
      eyebrow: 'Oferta · Holding & Protección Patrimonial',
      badge: `Solo hoy · $${offer} MXN`,
      title: `Solo por hoy:<br/>Holding & ${accent('Protección Patrimonial.')}`,
      lead: `${salute} porque ${escapeHtml(input.contextLine)}, tenemos algo especial solo por hoy: acceso a Holding & Protección Patrimonial con Diego Díaz a $${offer} MXN en lugar de $${regular}. Una condición exclusiva que no se repite después de hoy.`,
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Esta oferta desaparece a la medianoche. No hay extensión ni excepciones.
        </p>
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Si tu empresa ya tiene activos, contratos relevantes, socios o varias sociedades, esto te interesa: son <strong>2.5 horas</strong>, el <strong>${escapeHtml(input.eventDateLabel)}</strong>, <strong>100% online</strong>, para que sepas exactamente cómo separar riesgos, activos y operación antes de que un problema fiscal, legal o familiar te obligue a resolverlo bajo presión.
        </p>
        <div style="margin:0 0 8px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">— Al inscribirte hoy aseguras</div>
        <ul style="margin:0 0 22px;padding:0 0 0 18px;color:#5f574f;font-size:14px;line-height:1.75;">
          <li>Tu lugar en la sesión en vivo con Diego Díaz.</li>
          <li>El precio más bajo que vamos a ofrecer para este grupo.</li>
          <li>Material de apoyo + ruta para solicitar diagnóstico de tu caso.</li>
        </ul>
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Una vez que el reloj llegue a las <strong>11:59 PM</strong>, esta oferta ya no aplica.
        </p>
        <p style="margin:0 0 4px;color:#5f574f;font-size:14px;line-height:1.7;">
          ¿Tienes dudas antes de inscribirte? Responde a este correo y te ayudo directo.
        </p>
      `,
      ctaLabel: `Aprovecha tu precio exclusivo de $${offer}`,
      ctaUrl: input.stripeUrl,
      preheader: `Oferta ${escapeHtml(input.deadlineLabel)} · $${offer} MXN (antes $${regular}).`,
    }),
  );
};

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

// ═══════════════════════════════════════════════════════════════════════════
// Masterclass "El costo invisible de las 40 horas" — 28 sep 2026 · 5:00 PM
// Tres correos: invitacion (mañana del evento), recordatorio (1h antes) y
// aviso "en vivo ahora" (link real del stream). Todos apuntan al canal
// oficial YouTube: https://www.youtube.com/@YoSoyDiegoDiaz
// ═══════════════════════════════════════════════════════════════════════════

const MASTERCLASS_YT_CHANNEL = 'https://www.youtube.com/@YoSoyDiegoDiaz';
const MASTERCLASS_HERO_IMAGE = {
  url: 'https://diegodiaz.mx/emails/masterclass-40hrs-hero.jpg',
  alt: 'Masterclass gratuita — El costo invisible de las 40 horas · 28 sep 5:00 PM · YouTube @YoSoyDiegoDiaz',
};

const firstNameFrom = (raw?: string): string => {
  const first = String(raw || '').trim().split(/\s+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
};

export const sendMasterclass40HrsInvite = (input: {
  email: string;
  name?: string;
}): Promise<unknown> => {
  const first = firstNameFrom(input.name);
  const salute = first ? `${first},` : 'Empresario,';
  return send(
    input.email,
    '🚨 Hoy · Masterclass GRATUITA: El costo invisible de las 40 horas',
    emailShell({
      eyebrow: 'Masterclass gratuita · Hoy 5:00 PM',
      badge: 'Hoy · En vivo',
      title: `El costo invisible<br/>de las ${accent('40 horas.')}`,
      lead: `${salute} ¿estás preparado para el cambio de 48 a 40 horas laborales? Hoy, en vivo por YouTube, hablamos de cómo hacer que esta transición funcione —y cómo mantener, incluso mejorar, la productividad apoyándote en las herramientas adecuadas.`,
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          En esta masterclass abrimos el tema con datos reales: qué se rompe con la reducción de jornada, dónde está el costo que casi nadie mide, y qué palancas concretas te permiten sostener la operación sin desangrar el margen.
        </p>
        <div style="margin:0 0 8px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">— Reserva tu lugar</div>
        <ul style="margin:0 0 22px;padding:0 0 0 18px;color:#5f574f;font-size:14px;line-height:1.75;">
          <li><strong>Hoy · 5:00 PM</strong> (hora Ciudad de México).</li>
          <li>100% gratuita, en vivo por YouTube.</li>
          <li>Activa el recordatorio en el canal para no perderla.</li>
        </ul>
        <div style="margin:22px 0 8px;">
          ${linkButton({ label: 'Entrar al canal y activar recordatorio', detail: '@YoSoyDiegoDiaz', url: MASTERCLASS_YT_CHANNEL, dark: true })}
        </div>
        <p style="margin:20px 0 0;color:#5f574f;font-size:14px;line-height:1.7;">
          Nos vemos en la masterclass.
        </p>
      `,
      ctaLabel: 'Entrar al canal de YouTube',
      ctaUrl: MASTERCLASS_YT_CHANNEL,
      preheader: 'Hoy 5:00 PM en vivo por YouTube — El costo invisible de las 40 horas.',
      heroImage: MASTERCLASS_HERO_IMAGE,
      footerMeta: { left: '— Masterclass · Hoy 5:00 PM', right: 'En vivo por YouTube' },
    }),
  );
};

export const sendMasterclass40HrsReminder = (input: {
  email: string;
  name?: string;
}): Promise<unknown> => {
  const first = firstNameFrom(input.name);
  const salute = first ? `${first},` : 'Empresario,';
  return send(
    input.email,
    '⏰ Falta 1 hora · Masterclass "El costo invisible de las 40 horas"',
    emailShell({
      eyebrow: 'Masterclass · Falta 1 hora',
      badge: 'Empieza a las 5:00 PM',
      title: `Falta una hora<br/>para ${accent('empezar.')}`,
      lead: `${salute} en una hora comenzamos la masterclass gratuita "El costo invisible de las 40 horas". Un tema que cada vez cobra mayor relevancia: cómo hacer que la reducción de 48 a 40 horas laborales funcione sin perder productividad.`,
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          La clave está en las herramientas que utilizamos y en cómo las aplicamos. Vamos a repasar el marco completo para que salgas con acciones concretas para tu empresa.
        </p>
        <div style="margin:0 0 8px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9b9185;">— Datos del stream</div>
        <ul style="margin:0 0 22px;padding:0 0 0 18px;color:#5f574f;font-size:14px;line-height:1.75;">
          <li><strong>Hoy · 5:00 PM</strong> (hora Ciudad de México).</li>
          <li>En vivo por YouTube — canal <strong>@YoSoyDiegoDiaz</strong>.</li>
          <li>Ingresa unos minutos antes para no perderte la apertura.</li>
        </ul>
        <div style="margin:22px 0 8px;">
          ${linkButton({ label: 'Ir al canal y prepararme', detail: 'Faltan ~60 min', url: MASTERCLASS_YT_CHANNEL, dark: true })}
        </div>
        <p style="margin:20px 0 0;color:#5f574f;font-size:14px;line-height:1.7;">
          🔥 Nos vemos en una hora.
        </p>
      `,
      ctaLabel: 'Entrar al canal de YouTube',
      ctaUrl: MASTERCLASS_YT_CHANNEL,
      preheader: 'En una hora comenzamos — El costo invisible de las 40 horas.',
      heroImage: MASTERCLASS_HERO_IMAGE,
      footerMeta: { left: '— Faltan ~60 minutos', right: 'YouTube @YoSoyDiegoDiaz' },
    }),
  );
};

export const sendMasterclass40HrsLive = (input: {
  email: string;
  name?: string;
  liveUrl: string;
}): Promise<unknown> => {
  const first = firstNameFrom(input.name);
  const salute = first ? `${first},` : 'Empresario,';
  return send(
    input.email,
    '🔴 EN VIVO ahora · El costo invisible de las 40 horas',
    emailShell({
      eyebrow: 'Masterclass · En vivo ahora',
      badge: '● Live',
      title: `Ya estamos<br/>${accent('en vivo.')}`,
      lead: `${salute} arrancamos la masterclass "El costo invisible de las 40 horas". Conéctate ahora — te esperamos del otro lado.`,
      content: `
        <p style="margin:0 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Estamos hablando de cómo hacer que la reducción de 48 a 40 horas laborales funcione en tu empresa sin perder productividad. Entra ahora para no perderte la parte central.
        </p>
        <div style="margin:22px 0 8px;">
          ${linkButton({ label: '🔴 Conectarme al Live ahora', detail: 'YouTube · @YoSoyDiegoDiaz', url: input.liveUrl, dark: true })}
        </div>
        <p style="margin:18px 0 18px;color:#5f574f;font-size:14px;line-height:1.7;">
          Si el botón no abre, copia y pega este enlace en tu navegador:<br/>
          <span style="word-break:break-all;color:#111;">${escapeHtml(input.liveUrl)}</span>
        </p>
        <p style="margin:20px 0 0;color:#5f574f;font-size:14px;line-height:1.7;">
          ✅ Recuerda seguir el canal oficial y activar las notificaciones para no perderte ningún detalle de las próximas transmisiones.
        </p>
      `,
      ctaLabel: 'Ver ahora en YouTube',
      ctaUrl: input.liveUrl,
      preheader: 'Ya arrancamos — conéctate al live de YouTube ahora.',
      heroImage: MASTERCLASS_HERO_IMAGE,
      footerMeta: { left: '— Transmisión en curso', right: 'YouTube @YoSoyDiegoDiaz' },
    }),
  );
};
