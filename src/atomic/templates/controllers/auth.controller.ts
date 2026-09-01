import { RequestHandler } from 'express';
import { validationResult } from 'express-validator';
import * as authService from '../../organisms/services/auth.service.js';
import { success, created, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

export const register: RequestHandler = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { badRequest(res, errors.array()[0].msg as string); return; }
  try {
    const result = await authService.register(req.body);
    created(res, result);
  } catch (err: any) {
    err.statusCode === 409 ? badRequest(res, err.message) : serverError(res, err);
  }
};

export const login: RequestHandler = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { badRequest(res, errors.array()[0].msg as string); return; }
  try {
    const result = await authService.login(req.body);
    success(res, result);
  } catch (err: any) {
    res.status(err.statusCode ?? 500).json({ success: false, message: err.message });
  }
};

export const refresh: RequestHandler = async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) { badRequest(res, 'Refresh token required'); return; }
  try {
    const tokens = await authService.refreshTokens(refreshToken);
    success(res, tokens);
  } catch {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
};

export const me: RequestHandler = (req, res) => success(res, (req as any).user);

// Siempre responde genérico (no revela si el correo existe en la base).
export const forgotPassword: RequestHandler = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { badRequest(res, errors.array()[0].msg as string); return; }
  const { email } = req.body as { email: string };
  try {
    await authService.forgotPassword(email);
  } catch (err) {
    console.warn('[forgotPassword]', (err as Error).message);
  }
  success(res, { message: 'Si el correo existe, enviamos instrucciones para restablecer tu contraseña.' });
};

export const resetPassword: RequestHandler = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { badRequest(res, errors.array()[0].msg as string); return; }
  const { token, email, password } = req.body as { token: string; email: string; password: string };
  try {
    await authService.resetPassword({ token, email, password });
    success(res, { message: 'Tu contraseña fue actualizada correctamente.' });
  } catch (err: any) {
    res.status(err.statusCode ?? 500).json({ success: false, message: err.message });
  }
};

// Admin: crear cuenta de cliente y enviar credenciales por correo.
export const adminCreateUser: RequestHandler = async (req, res) => {
  const { name, email, role, tagIds, courseIds, marketingStatus } = req.body as {
    name?: string;
    email?: string;
    role?: 'user' | 'admin';
    tagIds?: string[];
    courseIds?: string[];
    marketingStatus?: 'never_subscribed' | 'subscribed' | 'unsubscribed';
  };
  if (!name || !email) { badRequest(res, 'name y email son requeridos'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { badRequest(res, 'Email inválido'); return; }
  try {
    const result = await authService.adminCreateUser({ name, email, role, tagIds, courseIds, marketingStatus });
    created(res, result);
  } catch (err: any) {
    err.statusCode === 409 ? badRequest(res, err.message) : serverError(res, err);
  }
};
