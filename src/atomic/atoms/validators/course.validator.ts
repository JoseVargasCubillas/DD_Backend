import { body } from 'express-validator';

export const createCourseValidator = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('category').notEmpty().withMessage('Category is required'),
];

export const updateCourseValidator = [
  body('title').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
];
