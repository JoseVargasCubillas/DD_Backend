import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IBookDocument extends SqlDocumentMethods<IBookDocument> {
  title: string;
  slug: string;
  subtitle: string;
  author: string;
  description: string;
  price: number;
  shippingCost: number;
  currency: string;
  format: string;
  pages: number;
  language: string;
  year: number;
  coverImage: string;
  stock: number;
  isActive: boolean;
  // Paquete de un solo ejemplar, para cotizar envio real con Envia — ver
  // shipping.service.ts. Al comprar varios, el peso se multiplica por la
  // cantidad y el alto se apila; largo/ancho se mantienen.
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Book = createSqlModel<IBookDocument>({
  table: 'books',
  defaults: () => ({
    subtitle: '',
    author: 'Diego Díaz',
    description: '',
    price: 0,
    shippingCost: 0,
    currency: 'MXN',
    format: 'Pasta blanda',
    pages: 0,
    language: 'Español',
    year: new Date().getFullYear(),
    coverImage: '',
    stock: 0,
    isActive: true,
    weightKg: 0.5,
    lengthCm: 25,
    widthCm: 20,
    heightCm: 3,
  }),
});
