import nodemailer from 'nodemailer';
import { env } from '../../../config/env.js';
import { IUserDocument } from '../../molecules/models/user.model.js';
import { IOrderDocument } from '../../molecules/models/order.model.js';

const transporter = nodemailer.createTransport({
  host: env.mail.host,
  port: env.mail.port,
  auth: { user: env.mail.user, pass: env.mail.pass },
});

const send = (to: string, subject: string, html: string): Promise<unknown> =>
  transporter.sendMail({ from: env.mail.from, to, subject, html });

export const sendWelcome = (user: IUserDocument): Promise<unknown> =>
  send(user.email, '¡Bienvenido a la Academia Diego Díaz!', `
    <h1>Hola ${user.name},</h1>
    <p>Gracias por unirte. Explora nuestros cursos y seminarios en <a href="${env.clientUrl}">diegodiaz.mx</a>.</p>
  `);

export const sendPasswordReset = (user: IUserDocument, resetUrl: string): Promise<unknown> =>
  send(user.email, 'Restablecer contraseña', `
    <p>Haz clic para restablecer tu contraseña (expira en 1 hora):</p>
    <a href="${resetUrl}">${resetUrl}</a>
  `);

export const sendOrderConfirmation = (user: IUserDocument, order: IOrderDocument): Promise<unknown> =>
  send(user.email, 'Confirmación de compra', `
    <h2>Tu compra fue exitosa</h2>
    <p>Total: $${order.total} ${order.currency}</p>
    <p>Gracias, ${user.name}.</p>
  `);
