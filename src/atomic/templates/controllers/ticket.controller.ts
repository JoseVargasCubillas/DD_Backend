import { RequestHandler } from 'express';
import * as ticketService from '../../organisms/services/ticket.service.js';
import { FOLIO_PATTERN, normalizeFolio, parseScannedTicket } from '../../atoms/helpers/ticket-token.helper.js';
import { success, notFound, forbidden, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

const signatureFrom = (value: unknown): string => (typeof value === 'string' ? value : '');

// GET /tickets/:folio?t=  (público — el QR lo abre el asistente)
export const getTicket: RequestHandler = async (req, res) => {
  try {
    const { ticket, reason } = await ticketService.getPublicTicket(req.params.folio, signatureFrom(req.query.t));
    if (reason === 'notFound') return notFound(res, 'Boleto no encontrado');
    if (reason === 'forbidden') return forbidden(res, 'Boleto no válido');
    success(res, ticket);
  } catch (err: any) {
    serverError(res, err);
  }
};

// GET /tickets/:folio/qr.png?t=
export const getTicketQr: RequestHandler = async (req, res) => {
  try {
    const png = await ticketService.renderTicketQrPng(req.params.folio, signatureFrom(req.query.t));
    if (!png) return notFound(res, 'Boleto no encontrado');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // El frontend vive en otro origen (diegodiaz.mx vs api.); helmet pone
    // CORP same-origin por defecto y el navegador bloquearía la imagen.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(png);
  } catch (err: any) {
    serverError(res, err);
  }
};

// POST /tickets/check-in { folio, t } | { code } (admin)
export const checkIn: RequestHandler = async (req, res) => {
  try {
    const body = req.body ?? {};
    const parsed = body.code ? parseScannedTicket(body.code) : null;
    const folio = normalizeFolio(parsed?.folio ?? body.folio);
    const signature = signatureFrom(parsed?.signature ?? body.t);
    if (!folio) return badRequest(res, 'Falta el folio del boleto');
    if (!FOLIO_PATTERN.test(folio)) return success(res, { result: 'invalid' });

    const admin = (req as any).user;
    const adminLabel = admin?.name || admin?.email || String(admin?.id ?? admin?._id ?? 'admin');
    success(res, await ticketService.checkInTicket(folio, signature, adminLabel));
  } catch (err: any) {
    serverError(res, err);
  }
};

// POST /tickets/:folio/undo-check-in (admin)
export const undoCheckIn: RequestHandler = async (req, res) => {
  try {
    const ticket = await ticketService.undoCheckIn(req.params.folio);
    if (!ticket) return notFound(res, 'Boleto no encontrado');
    success(res, ticket);
  } catch (err: any) {
    serverError(res, err);
  }
};

// GET /events/:id/attendees (admin) — id de Event o slug de catálogo
export const listEventAttendees: RequestHandler = async (req, res) => {
  try {
    success(res, await ticketService.listEventAttendees(req.params.id));
  } catch (err: any) {
    serverError(res, err);
  }
};
