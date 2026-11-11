import { RequestHandler } from 'express';
import * as ticketService from '../../organisms/services/ticket.service.js';
import * as attendeeAdmin from '../../organisms/services/attendee-admin.service.js';
import { AttendeeError } from '../../organisms/services/attendee-admin.service.js';
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

// GET /tickets/check-in/events (admin | staff) — eventos con boletos, para el selector del escáner
export const listCheckInEvents: RequestHandler = async (_req, res) => {
  try {
    success(res, await ticketService.listCheckInEvents());
  } catch (err: any) {
    serverError(res, err);
  }
};

// POST /tickets/check-in { folio, t, eventKey } | { code, eventKey } (admin | staff)
// eventKey fija el evento que se está escaneando: un boleto de otro evento se
// rechaza (wrongEvent) sin registrar asistencia. Para staff es obligatorio.
export const checkIn: RequestHandler = async (req, res) => {
  try {
    const body = req.body ?? {};
    const parsed = body.code ? parseScannedTicket(body.code) : null;
    const folio = normalizeFolio(parsed?.folio ?? body.folio);
    const signature = signatureFrom(parsed?.signature ?? body.t);
    if (!folio) return badRequest(res, 'Falta el folio del boleto');

    const admin = (req as any).user;
    const isStaff = admin?.role === 'staff';
    const eventKey = typeof body.eventKey === 'string' ? body.eventKey.trim() : '';
    if (isStaff && !eventKey) return badRequest(res, 'Selecciona el evento que estás escaneando');
    if (!FOLIO_PATTERN.test(folio)) return success(res, { result: 'invalid' });

    const adminLabel = admin?.name || admin?.email || String(admin?.id ?? admin?._id ?? 'admin');
    const result = await ticketService.checkInTicket(folio, signature, adminLabel, eventKey);
    success(res, isStaff && result.ticket ? { ...result, ticket: ticketService.redactTicketForStaff(result.ticket) } : result);
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

// Errores de las herramientas de asistentes: AttendeeError trae su código HTTP.
const attendeeFail = (res: Parameters<RequestHandler>[1], err: unknown) =>
  err instanceof AttendeeError
    ? res.status(err.statusCode).json({ success: false, message: err.message })
    : serverError(res, err as Error);

// POST /events/:id/attendees (admin) { name, email, phone?, amount?, ticketType?, sendEmail?, force? }
export const addAttendee: RequestHandler = async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await attendeeAdmin.addAttendee({
      eventIdOrSlug: req.params.id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      amount: body.amount,
      ticketType: body.ticketType === 'VIP' ? 'VIP' : body.ticketType === 'General' ? 'General' : undefined,
      sendEmail: body.sendEmail !== false,
      force: body.force === true,
    });
    success(res, result, 201);
  } catch (err) {
    attendeeFail(res, err);
  }
};

// POST /tickets/:folio/void (admin) — baja reversible
export const voidAttendee: RequestHandler = async (req, res) => {
  try {
    success(res, await attendeeAdmin.voidAttendee(req.params.folio));
  } catch (err) {
    attendeeFail(res, err);
  }
};

// POST /tickets/:folio/reactivate (admin)
export const reactivateAttendee: RequestHandler = async (req, res) => {
  try {
    success(res, await attendeeAdmin.reactivateAttendee(req.params.folio));
  } catch (err) {
    attendeeFail(res, err);
  }
};

// DELETE /tickets/:folio (admin) — solo altas manuales
export const deleteAttendee: RequestHandler = async (req, res) => {
  try {
    await attendeeAdmin.deleteAttendee(req.params.folio);
    success(res, { deleted: true });
  } catch (err) {
    attendeeFail(res, err);
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
