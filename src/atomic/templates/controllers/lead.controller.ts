import { RequestHandler } from 'express';
import * as leadService from '../../organisms/services/lead.service.js';
import { badRequest, created, notFound, serverError, success } from '../../atoms/helpers/response.helper.js';

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

export const requestEstrategiaFiscalDossier: RequestHandler = async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const phone = req.body?.phone ? String(req.body.phone).trim() : undefined;

    if (!email) return badRequest(res, 'El correo es requerido.');
    if (!name) return badRequest(res, 'El nombre es requerido.');
    if (!phone) return badRequest(res, 'El número de teléfono es requerido.');

    const lead = await leadService.sendEstrategiaFiscalDossier({ email, name, phone });
    return created(res, {
      email: lead.email,
      source: lead.source,
      phone: lead.phone,
      emailedAt: lead.emailedAt,
    });
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const requestDownloadableResource: RequestHandler = async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const phone = req.body?.phone ? String(req.body.phone).trim() : undefined;
    const resourceId = String(req.body?.resourceId ?? '').trim();
    const resourceTitle = String(req.body?.resourceTitle ?? '').trim();
    const downloadUrl = String(req.body?.downloadUrl ?? '').trim();

    if (!email) return badRequest(res, 'El correo es requerido.');
    if (!resourceId || !resourceTitle || !downloadUrl) {
      return badRequest(res, 'La información del recurso es requerida.');
    }

    const lead = await leadService.sendDownloadableResource({
      email,
      name,
      phone,
      resourceId,
      resourceTitle,
      downloadUrl,
    });

    return created(res, {
      email: lead.email,
      source: lead.source,
      phone: lead.phone,
      emailedAt: lead.emailedAt,
      downloadUrl,
    });
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const subscribeNewsletter: RequestHandler = async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const origin = req.body?.origin ? String(req.body.origin).trim() : undefined;

    if (!email) return badRequest(res, 'El correo es requerido.');

    const lead = await leadService.subscribeNewsletter({
      email,
      name,
      meta: origin ? { origin } : undefined,
    });
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

export const subscribeSatWaitlist: RequestHandler = async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;

    if (!email) return badRequest(res, 'El correo es requerido.');

    const lead = await leadService.subscribeSatWaitlist({ email, name });
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

export const remove: RequestHandler = async (req, res) => {
  try {
    const removed = await leadService.deleteLead(req.params.id);
    if (!removed) return notFound(res, 'Lead no encontrado.');
    return success(res, { id: req.params.id });
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const bulkRemove: RequestHandler = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const result = await leadService.deleteLeads(ids);
    return success(res, result);
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};
