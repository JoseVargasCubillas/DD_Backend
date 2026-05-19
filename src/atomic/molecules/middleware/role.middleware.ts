import { RequestHandler } from 'express';
import { forbidden } from '../../atoms/helpers/response.helper.js';

export const requireRole = (...roles: string[]): RequestHandler => (req, res, next) => {
  const user = (req as any).user;
  if (!roles.includes(user?.role)) { forbidden(res); return; }
  next();
};

export const requireAdmin = requireRole('admin');
