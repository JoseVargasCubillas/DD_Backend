import { RequestHandler } from 'express';
import * as bookService from '../../organisms/services/book.service.js';
import { notFound, serverError, success } from '../../atoms/helpers/response.helper.js';

export const list: RequestHandler = async (_req, res) => {
  try {
    success(res, await bookService.listBooks());
  } catch (err: any) { serverError(res, err); }
};

export const getBySlug: RequestHandler = async (req, res) => {
  try {
    success(res, await bookService.getBookBySlug(req.params.slug));
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
