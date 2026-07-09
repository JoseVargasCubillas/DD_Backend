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

const formatPlanName = (value: string): string =>
  String(value || '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const send = (to: string, subject: string, html: string): Promise<unknown> =>
  transporter.sendMail({
    from: env.mail.from || 'Diego Diaz <servicios@diegodiaz.mx>',
    replyTo: 'servicios@diegodiaz.mx',
    to,
    subject,
    html,
  });

const emailShell = ({
  eyebrow,
  title,
  lead,
  content,
  ctaLabel,
  ctaUrl,
  preheader,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  content: string;
  ctaLabel?: string;
  ctaUrl?: string;
  preheader?: string;
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
                        <div style="font-size:13px;letter-spacing:5px;text-transform:uppercase;color:#17130f;font-weight:700;">Diego Diaz</div>
                        <div style="margin-top:6px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#9f9588;">Estrategia Fiscal</div>
                      </td>
                      <td align="right" style="vertical-align:middle;">
                        <div style="display:inline-block;border:1px solid #cfc5b7;padding:9px 12px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#7e7468;">Academia</div>
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
                        <div style="font-size:10px;letter-spacing:5px;text-transform:uppercase;color:#b6aa9a;">${escapeHtml(eyebrow)}</div>
                        <h1 style="margin:18px 0 0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:48px;line-height:.98;color:#f7f1e8;">${escapeHtml(title)}</h1>
                        <p style="margin:22px 0 0;max-width:560px;font-size:15px;line-height:1.7;color:#cfc4b6;">${escapeHtml(lead)}</p>
                      </td>
                    </tr>
                  </table>
                  ${ctaLabel && ctaUrl ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;margin-top:30px;background:#f7f1e8;color:#080706;text-decoration:none;padding:15px 22px;font-size:11px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;">${escapeHtml(ctaLabel)}</a>` : ''}
                </td>
              </tr>
              <tr>
                <td style="padding:34px;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td style="padding:26px 34px;border-top:1px solid #e4dccf;background:#f6f1e8;color:#8b8175;font-size:12px;line-height:1.7;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#17130f;">El exito ama la preparacion.</td>
                      <td align="right" style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9c9286;">Diego Diaz</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding-top:12px;color:#8b8175;">Si necesitas apoyo, responde este correo o escribe a servicios@diegodiaz.mx.</td>
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

const confirmationPanel = ({
  label,
  value,
  description,
  rows,
}: {
  label: string;
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
              <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b6aa9a;">${escapeHtml(label)}</div>
              <div style="margin-top:10px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.05;color:#f7f1e8;">${escapeHtml(value)}</div>
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
  send(user.email, 'Bienvenido a la Academia Diego Diaz', emailShell({
    eyebrow: 'Bienvenida',
    title: 'Tu cuenta esta lista.',
    lead: `Hola ${user.name}, gracias por unirte a la Academia Diego Diaz.`,
    content: '<p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">Explora tus cursos, sesiones y materiales desde tu cuenta.</p>',
    ctaLabel: 'Entrar a Academia',
    ctaUrl: env.clientUrl,
    preheader: 'Tu cuenta de Academia Diego Diaz esta lista.',
  }));

export const sendPasswordReset = (user: IUserDocument, resetUrl: string): Promise<unknown> =>
  send(user.email, 'Restablecer contrasena', emailShell({
    eyebrow: 'Seguridad',
    title: 'Restablece tu contrasena.',
    lead: 'Este enlace expira en 1 hora.',
    content: '<p style="margin:0;color:#5f574f;font-size:14px;line-height:1.7;">Si no solicitaste este cambio, puedes ignorar este correo.</p>',
    ctaLabel: 'Restablecer',
    ctaUrl: resetUrl,
    preheader: 'Usa este enlace para restablecer tu contrasena.',
  }));

export const sendOrderConfirmation = (user: IUserDocument, order: IOrderDocument): Promise<unknown> =>
  send(user.email, 'Confirmacion de compra', emailShell({
    eyebrow: 'Compra confirmada',
    title: 'Tu compra fue exitosa.',
    lead: `Gracias, ${user.name}. Tu acceso esta siendo preparado.`,
    content: detailRows([
      ['Total', `$${order.total} ${order.currency}`],
      ['Orden', String(order._id || order.id || '')],
    ]),
    ctaLabel: 'Ir a mi cuenta',
    ctaUrl: `${env.clientUrl}/mi-cuenta`,
    preheader: 'Tu compra fue confirmada correctamente.',
  }));

export const sendAdminSubscriptionNotice = (input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  plan: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
}): Promise<unknown> =>
  send(ADMIN_NOTICE_EMAIL, 'Nueva compra confirmada en Academia Diego Diaz', emailShell({
    eyebrow: 'Compra confirmada',
    title: 'Nueva suscripcion pagada.',
    lead: 'Stripe confirmo el pago de una nueva suscripcion en Academia.',
    content: confirmationPanel({
      label: 'Venta registrada',
      value: formatPlanName(input.plan),
      description: 'Datos del cliente y referencia de Stripe para seguimiento administrativo.',
      rows: [
      ['Plan', formatPlanName(input.plan)],
      ['Nombre', input.customerName],
      ['Correo', input.customerEmail],
      ['Telefono', input.customerPhone],
      ['Stripe Sub', input.stripeSubscriptionId],
      ['Stripe Price', input.stripePriceId],
      ],
    }),
    preheader: `Nueva suscripcion pagada: ${formatPlanName(input.plan)}.`,
  }));

export const sendCustomerSubscriptionNotice = (input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  plan: string;
  stripeSubscriptionId: string;
}): Promise<unknown> =>
  send(input.customerEmail, 'Tu pago fue confirmado - Academia Diego Diaz', emailShell({
    eyebrow: 'Academia',
    title: 'Tu pago fue confirmado.',
    lead: `Hola ${input.customerName}, gracias por unirte a Academia Diego Diaz.`,
    content: `
      ${confirmationPanel({
        label: 'Acceso confirmado',
        value: formatPlanName(input.plan),
        description: 'Tu suscripcion quedo activa. Conserva esta informacion como referencia de tu registro.',
        rows: [
        ['Plan', formatPlanName(input.plan)],
        ['Correo', input.customerEmail],
        ['Telefono', input.customerPhone],
        ['Referencia', input.stripeSubscriptionId],
        ],
      })}
    `,
    ctaLabel: 'Entrar a Academia',
    ctaUrl: `${env.clientUrl}/academia`,
    preheader: `Tu pago de Academia ${formatPlanName(input.plan)} fue confirmado.`,
  }));
