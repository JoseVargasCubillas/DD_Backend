import { RequestHandler } from 'express';
import * as waClickService from '../../organisms/services/wa-click.service.js';
import { created, serverError, success } from '../../atoms/helpers/response.helper.js';

const clientIp = (req: any): string | undefined => {
  const fwd = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return fwd || req.ip || undefined;
};

export const track: RequestHandler = async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const source = body.source ? String(body.source) : undefined;
    const page = body.page ? String(body.page) : undefined;
    const message = body.message ? String(body.message) : undefined;
    const anonId = body.anonId ? String(body.anonId) : undefined;
    const referrer = body.referrer ? String(body.referrer) : undefined;

    const click = await waClickService.recordClick({
      source,
      page,
      message,
      anonId,
      referrer,
      userAgent: String(req.headers?.['user-agent'] ?? '') || undefined,
      ip: clientIp(req),
      meta: (body.meta as Record<string, unknown>) ?? undefined,
    });

    return created(res, { id: click.id, source: click.source });
  } catch (err: any) {
    // Nunca romper la UX del cliente: si algo falla devolvemos 202 vacío.
    return res.status(202).json({ success: true });
  }
};

export const stats: RequestHandler = async (_req, res) => {
  try {
    const data = await waClickService.getStats();
    return success(res, data);
  } catch (err: any) {
    return serverError(res, err);
  }
};

export const list: RequestHandler = async (req, res) => {
  try {
    const source = req.query.source ? String(req.query.source) : undefined;
    const clicks = await waClickService.listClicks(source);
    return success(res, clicks);
  } catch (err: any) {
    return serverError(res, err);
  }
};
