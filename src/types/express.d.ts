import { Request } from 'express';
import { IUser } from './index.js';

export interface AuthRequest extends Request {
  user: IUser;
}
