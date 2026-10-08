import { RequestHandler } from 'express';
import * as catalog from '../../organisms/services/event-catalog.service.js';
import * as hubspot from '../../organisms/services/hubspot.service.js';
import { success, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

type Req = Parameters<RequestHandler>[0];
type Res = Parameters<RequestHandler>[1];

const adminLabelOf = (req: Req): string => {
  const admin = (req as any).user;
  return admin?.name || admin?.email || String(admin?.id ?? admin?._id ?? 'admin');
};

// Errores con statusCode < 500 (validación, HubSpot pausado) se devuelven tal cual.
const respondError = (res: Res, err: any) =>
  err?.statusCode && err.statusCode < 500
    ? res.status(err.statusCode).json({ success: false, message: err.message })
    : serverError(res, err);

// GET /integrations/status (admin) — calendario + HubSpot para el panel
export const getStatus: RequestHandler = async (_req, res) => {
  try {
    success(res, { catalog: await catalog.getCatalogStatus(), hubspot: await hubspot.getHubspotStatus() });
  } catch (err: any) {
    serverError(res, err);
  }
};

// POST /integrations/event-catalog { events: [...] } (admin)
export const syncEventCatalog: RequestHandler = async (req, res) => {
  try {
    if (!Array.isArray(req.body?.events)) return badRequest(res, 'Falta la lista de eventos del calendario.');
    success(res, await catalog.syncCatalog(req.body.events, adminLabelOf(req)));
  } catch (err: any) {
    respondError(res, err);
  }
};

// POST /integrations/hubspot/sync (admin)
export const syncHubspotNow: RequestHandler = async (_req, res) => {
  try {
    success(res, await hubspot.runHubspotSyncNow());
  } catch (err: any) {
    respondError(res, err);
  }
};
