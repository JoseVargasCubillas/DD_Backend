import { createHash, timingSafeEqual } from 'node:crypto';
import { RequestHandler } from 'express';
import { env } from '../../../config/env.js';
import { unauthorized } from '../../atoms/helpers/response.helper.js';
import { authenticate } from './auth.middleware.js';
import { requireAdmin } from './role.middleware.js';

// Se comparan los hash SHA-256 (misma longitud siempre) con timingSafeEqual para
// no filtrar la clave por diferencias de tiempo de respuesta.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const isValidReadApiKey = (candidate: string): boolean => {
  const expected = env.readApiKey;
  // Sin READ_API_KEY configurada, la clave está deshabilitada: ninguna es válida.
  if (!expected || !candidate) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
};

/**
 * Acceso de SOLO LECTURA para integraciones (n8n / ranking) sin iniciar sesión:
 * - Si llega el header `X-API-Key`, debe coincidir con READ_API_KEY.
 * - Si no llega, se exige un admin con sesión (JWT), como antes.
 * Se usa únicamente en rutas GET concretas; la clave no abre nada más.
 */
export const adminOrReadApiKey: RequestHandler = (req, res, next) => {
  const key = req.header('x-api-key');
  if (key === undefined) {
    void authenticate(req, res, (err?: unknown) => {
      if (err) { next(err); return; }
      requireAdmin(req, res, next);
    });
    return;
  }
  if (!isValidReadApiKey(key)) { unauthorized(res, 'API key inválida'); return; }
  next();
};
