import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';

interface TokenPayload {
  id: string;
  role?: string;
}

export const signAccessToken = (payload: TokenPayload): string =>
  jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn } as jwt.SignOptions);

export const signRefreshToken = (payload: Pick<TokenPayload, 'id'>): string =>
  jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn } as jwt.SignOptions);

export const verifyAccessToken = (token: string): TokenPayload =>
  jwt.verify(token, env.jwt.secret) as TokenPayload;

export const verifyRefreshToken = (token: string): Pick<TokenPayload, 'id'> =>
  jwt.verify(token, env.jwt.refreshSecret) as Pick<TokenPayload, 'id'>;
