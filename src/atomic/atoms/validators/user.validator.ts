import { body } from 'express-validator';

export const updateProfileValidator = [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().isMobilePhone('any'),
  body('bio').optional().isLength({ max: 500 }),
];
