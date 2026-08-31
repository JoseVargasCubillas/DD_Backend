import { RequestHandler } from 'express';
import * as receiptService from '../../organisms/services/receipt.service.js';
import { success, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const getSubscriptionReceipt: RequestHandler = async (req, res) => {
  try {
    const receipt = await receiptService.getSubscriptionReceipt(req.params.id);
    if (!receipt) return notFound(res, 'Recibo no encontrado');
    success(res, receipt);
  } catch (err: any) {
    serverError(res, err);
  }
};

export const getOrderReceipt: RequestHandler = async (req, res) => {
  try {
    const receipt = await receiptService.getOrderReceipt(req.params.id);
    if (!receipt) return notFound(res, 'Recibo no encontrado');
    success(res, receipt);
  } catch (err: any) {
    serverError(res, err);
  }
};
