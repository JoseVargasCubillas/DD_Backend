import { Response } from 'express';

interface Pagination {
  total: number;
  page: number;
  pages: number;
}

export const success = <T>(res: Response, data: T, statusCode = 200): Response =>
  res.status(statusCode).json({ success: true, data });

export const paginated = <T>(res: Response, data: T[], pagination: Pagination): Response =>
  res.status(200).json({ success: true, data, pagination });

export const created = <T>(res: Response, data: T): Response => success(res, data, 201);

export const noContent = (res: Response): Response => res.status(204).send();

export const notFound = (res: Response, message = 'Not found'): Response =>
  res.status(404).json({ success: false, message });

export const badRequest = (res: Response, message: string): Response =>
  res.status(400).json({ success: false, message });

export const unauthorized = (res: Response, message = 'Unauthorized'): Response =>
  res.status(401).json({ success: false, message });

export const forbidden = (res: Response, message = 'Forbidden'): Response =>
  res.status(403).json({ success: false, message });

export const serverError = (res: Response, err: Error): Response =>
  res.status(500).json({ success: false, message: err.message ?? 'Server error' });
