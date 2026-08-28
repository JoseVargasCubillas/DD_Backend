import { RequestHandler } from 'express';
import * as leadService from '../../organisms/services/lead.service.js';
import { badRequest, created, serverError, success } from '../../atoms/helpers/response.helper.js';

export const requestSatGuide: RequestHandler = async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;

    if (!email) return badRequest(res, 'El correo es requerido.');

    const lead = await leadService.sendSatGuide({ email, name });
    return created(res, {
      email: lead.email,
      source: lead.source,
      emailedAt: lead.emailedAt,
    });
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const requestMediaKit: RequestHandler = async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;

    if (!email) return badRequest(res, 'El correo es requerido.');

    const lead = await leadService.sendMediaKit({ email, name });
    return created(res, {
      email: lead.email,
      source: lead.source,
      emailedAt: lead.emailedAt,
    });
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const list: RequestHandler = async (req, res) => {
  try {
    const source = req.query.source ? String(req.query.source) : undefined;
    const leads = await leadService.listLeads(source as any);
    return success(res, leads);
  } catch (err: any) {
    return serverError(res, err);
  }
};
