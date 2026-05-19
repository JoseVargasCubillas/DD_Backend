import { RequestHandler } from 'express';
import { verifyAccessToken } from '../../atoms/helpers/jwt.helper.js';
import { unauthorized } from '../../atoms/helpers/response.helper.js';
import { User } from '../models/user.model.js';

export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { unauthorized(res); return; }

  try {
    const token = header.split(' ')[1];
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) { unauthorized(res); return; }
    (req as any).user = user;
    next();
  } catch {
    unauthorized(res, 'Token expired or invalid');
  }
};
