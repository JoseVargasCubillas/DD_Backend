import { RequestHandler, Response } from 'express';
import * as shipmentService from '../../organisms/services/shipment.service.js';
import { lookupPostalCode } from '../../organisms/services/postal-code.service.js';
import { IShippingAdvisorDocument } from '../../molecules/models/shipping-advisor.model.js';
import { success, created, notFound, serverError } from '../../atoms/helpers/response.helper.js';

// Errores del servicio: pueden traer `errors` (lista de datos por corregir),
// `warnings` y, en duplicados, `code`/`duplicate` para que el front lo muestre.
const fail = (res: Response, err: any): Response => {
  const status = Number(err?.statusCode) || 0;
  if (!status || status >= 500) return serverError(res, err);
  return res.status(status).json({
    success: false,
    message: err.message,
    ...(err.errors ? { errors: err.errors } : {}),
    ...(err.warnings ? { warnings: err.warnings } : {}),
    ...(err.code ? { code: err.code } : {}),
    ...(err.duplicate ? { duplicate: err.duplicate } : {}),
  });
};

const reviewerOf = (req: Parameters<RequestHandler>[0]): string => {
  const user = (req as any).user as { name?: string; email?: string } | undefined;
  return user?.name || user?.email || 'admin';
};

// Resuelve el link del asesor; si no existe o está desactivado responde un
// 404 genérico (sin revelar si la ruta existe).
const withAdvisor =
  (handler: (advisor: IShippingAdvisorDocument, req: Parameters<RequestHandler>[0], res: Response) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    try {
      const advisor = await shipmentService.findActiveAdvisorByToken(req.params.token);
      if (!advisor) { notFound(res, 'No encontrado'); return; }
      await handler(advisor, req, res);
    } catch (err) {
      fail(res, err);
    }
  };

// ── Público (por token de asesor) ────────────────────────────

export const publicInfo: RequestHandler = withAdvisor(async (advisor, _req, res) => {
  const books = await shipmentService.listPublicBooks();
  success(res, { advisorName: advisor.name, books });
});

// Ayuda de captura: dado un CP devuelve estado, ciudad y colonias para
// autollenar el formulario. `unavailable` = el servicio externo no respondió.
export const publicPostalCode: RequestHandler = withAdvisor(async (_advisor, req, res) => {
  const lookup = await lookupPostalCode(String(req.params.postalCode || ''));
  if (lookup.status === 'ok') success(res, { found: true, ...lookup.info });
  else success(res, { found: false, unavailable: lookup.status === 'unavailable' });
});

export const publicValidate: RequestHandler = withAdvisor(async (_advisor, req, res) => {
  const result = await shipmentService.validateShipmentDraft(req.body ?? {});
  success(res, {
    errors: result.errors,
    warnings: result.warnings,
    quotedPrice: result.quote?.totalPrice ?? null,
    duplicate: result.duplicate,
  });
});

export const publicSubmit: RequestHandler = withAdvisor(async (advisor, req, res) => {
  const shipment = await shipmentService.submitShipment(advisor, req.body ?? {}, {
    confirmDuplicate: Boolean(req.body?.confirmDuplicate),
  });
  created(res, { _id: shipment._id, warnings: shipment.warnings });
});

export const publicMine: RequestHandler = withAdvisor(async (advisor, _req, res) => {
  success(res, await shipmentService.listAdvisorShipments(advisor._id));
});

// ── Admin: asesores ──────────────────────────────────────────

export const listAdvisors: RequestHandler = async (_req, res) => {
  try { success(res, await shipmentService.listAdvisors()); } catch (err) { fail(res, err); }
};

export const createAdvisor: RequestHandler = async (req, res) => {
  try { created(res, await shipmentService.createAdvisor(req.body ?? {})); } catch (err) { fail(res, err); }
};

export const updateAdvisor: RequestHandler = async (req, res) => {
  try { success(res, await shipmentService.updateAdvisor(req.params.id, req.body ?? {})); } catch (err) { fail(res, err); }
};

export const rotateAdvisorToken: RequestHandler = async (req, res) => {
  try { success(res, await shipmentService.rotateAdvisorToken(req.params.id)); } catch (err) { fail(res, err); }
};

// ── Admin: envíos ────────────────────────────────────────────

export const listShipments: RequestHandler = async (req, res) => {
  try {
    const { status, source, search, page, limit } = req.query as Record<string, string>;
    success(res, await shipmentService.listShipments({ status, source, search, page: Number(page), limit: Number(limit) }));
  } catch (err) { fail(res, err); }
};

export const getShipment: RequestHandler = async (req, res) => {
  try { success(res, await shipmentService.getShipment(req.params.id)); } catch (err) { fail(res, err); }
};

export const getQuotes: RequestHandler = async (req, res) => {
  try { success(res, await shipmentService.getShipmentQuotes(req.params.id)); } catch (err) { fail(res, err); }
};

export const editShipment: RequestHandler = async (req, res) => {
  try { success(res, await shipmentService.editShipment(req.params.id, req.body ?? {})); } catch (err) { fail(res, err); }
};

export const approveShipment: RequestHandler = async (req, res) => {
  try {
    const { carrier, service } = (req.body ?? {}) as { carrier?: string; service?: string };
    success(res, await shipmentService.approveShipment(req.params.id, reviewerOf(req), { carrier, service }));
  } catch (err) { fail(res, err); }
};

export const rejectShipment: RequestHandler = async (req, res) => {
  try {
    success(res, await shipmentService.rejectShipment(req.params.id, reviewerOf(req), String(req.body?.reason ?? '')));
  } catch (err) { fail(res, err); }
};

export const refreshTracking: RequestHandler = async (req, res) => {
  try { success(res, await shipmentService.refreshShipmentTracking(req.params.id)); } catch (err) { fail(res, err); }
};

export const refreshAllTracking: RequestHandler = async (_req, res) => {
  try { success(res, await shipmentService.refreshAllTracking()); } catch (err) { fail(res, err); }
};
