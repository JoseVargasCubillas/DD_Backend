import { body } from 'express-validator';

export const registerValidator = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email')
    .isEmail()
    .customSanitizer((value) => String(value).trim().toLowerCase())
    .withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password min 8 chars'),
];

export const loginValidator = [
  body('email').isEmail().customSanitizer((value) => String(value).trim().toLowerCase()),
  body('password').notEmpty(),
];

export const changePasswordValidator = [
  body('currentPassword').notEmpty().withMessage('La contraseña actual es requerida'),
  body('newPassword').isLength({ min: 8 }).withMessage('La nueva contraseña debe tener al menos 8 caracteres'),
];

export const forgotPasswordValidator = [
  body('email').isEmail().customSanitizer((value) => String(value).trim().toLowerCase()).withMessage('Valid email required'),
];

export const resetPasswordValidator = [
  body('token').notEmpty().withMessage('Token is required'),
  body('email').isEmail().customSanitizer((value) => String(value).trim().toLowerCase()).withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password min 8 chars'),
];
