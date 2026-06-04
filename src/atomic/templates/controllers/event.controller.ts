import { RequestHandler } from 'express';
import * as eventService from '../../organisms/services/event.service.js';
import { success, created, paginated, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const create: RequestHandler = async (req, res) => {
  try {
    const event = await eventService.createEvent({ ...req.body, instructor: (req as any).user._id });
    created(res, event);
  } catch (err: any) { serverError(res, err); }
};

export const list: RequestHandler = async (req, res) => {
  try {
    const { page, limit, status } = req.query as Record<string, string>;
    const result = await eventService.listEvents({ page: +page || 1, limit: +limit || 10, status });
    paginated(res, result.events, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) {
    console.error('[Events.list] Error:', err.message, err.stack);
    serverError(res, err);
  }
};

export const getBySlug: RequestHandler = async (req, res) => {
  try {
    const event = await eventService.getEventBySlug(req.params.slug);
    success(res, event);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const update: RequestHandler = async (req, res) => {
  try {
    const event = await eventService.updateEvent(req.params.id, req.body);
    success(res, event);
  } catch (err: any) { serverError(res, err); }
};

export const register: RequestHandler = async (req, res) => {
  try {
    const event = await eventService.registerToEvent(req.params.id, String((req as any).user._id));
    success(res, event);
  } catch (err: any) { serverError(res, err); }
};
