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
