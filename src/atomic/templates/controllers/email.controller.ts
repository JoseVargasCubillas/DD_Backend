import { RequestHandler } from 'express';
import { User, IUserDocument } from '../../molecules/models/user.model.js';
import * as emailService from '../../organisms/services/email.service.js';
import { success, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

/**
 * POST /api/v1/email/broadcast
 * Body: { subject, html, segment }
 * segment: 'all' | 'subscribed' | 'customers' | 'leads' | tagId (string)
 */
export const sendBroadcast: RequestHandler = async (req, res) => {
  try {
    const { subject, html, segment = 'subscribed' } = req.body as {
      subject: string;
      html: string;
      segment?: string;
    };

    if (!subject?.trim()) return badRequest(res, 'El asunto es requerido.');
    if (!html?.trim()) return badRequest(res, 'El contenido es requerido.');

    // Obtener todos los usuarios activos según segmento
    const allUsers = await User.find({ isActive: true });

    let targets = allUsers;

    if (segment === 'subscribed') {
      targets = allUsers.filter((u) => u.marketingStatus === 'subscribed');
    } else if (segment === 'customers') {
      targets = allUsers.filter((u) => u.contactStatus === 'customer');
    } else if (segment === 'leads') {
      targets = allUsers.filter((u) => u.contactStatus === 'lead');
    } else if (segment !== 'all') {
      // segment es un tagId
      targets = allUsers.filter((u) => u.tagIds.includes(segment));
    }

    if (targets.length === 0) {
      return badRequest(res, 'No hay destinatarios en el segmento seleccionado.');
    }

    // Enviar en lotes de 50 para no saturar el servidor SMTP
    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((user) =>
          (emailService as any).send
            ? (emailService as any).send(user.email, subject, html)
            : Promise.resolve()
        )
      ).then((results) => {
        results.forEach((r) => {
          if (r.status === 'fulfilled') sent++;
          else failed++;
        });
      });
    }

    success(res, { sent, failed, total: targets.length });
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/contacts?segment=all|subscribed|customers|leads
 * Retorna la lista de contactos del segmento para previsualización en la UI
 */
export const getSegmentContacts: RequestHandler = async (req, res) => {
  try {
    const segment = (req.query.segment as string) || 'all'
    const allUsers = await User.find({ isActive: true }).select('name email contactStatus marketingStatus tagIds');

    let targets: IUserDocument[] = allUsers;
    if (segment === 'subscribed') {
      targets = allUsers.filter((u) => u.marketingStatus === 'subscribed');
    } else if (segment === 'customers') {
      targets = allUsers.filter((u) => u.contactStatus === 'customer');
    } else if (segment === 'leads') {
      targets = allUsers.filter((u) => u.contactStatus === 'lead');
    } else if (segment !== 'all') {
      targets = allUsers.filter((u) => u.tagIds?.includes(segment));
    }

    const contacts = targets.map((u) => ({ name: u.name, email: u.email }));
    success(res, contacts);
  } catch (err: any) {
    serverError(res, err);
  }
};

/**
 * GET /api/v1/email/segments
 * Retorna conteos por segmento para mostrar en la UI
 */
export const getSegments: RequestHandler = async (req, res) => {
  try {
    const allUsers = await User.find({ isActive: true });

    const segments = {
      all: allUsers.length,
      subscribed: allUsers.filter((u) => u.marketingStatus === 'subscribed').length,
      customers: allUsers.filter((u) => u.contactStatus === 'customer').length,
      leads: allUsers.filter((u) => u.contactStatus === 'lead').length,
    };

    success(res, segments);
  } catch (err: any) {
    serverError(res, err);
  }
};
