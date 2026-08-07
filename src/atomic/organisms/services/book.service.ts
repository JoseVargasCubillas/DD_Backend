import { Book, IBookDocument } from '../../molecules/models/book.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

export const listBooks = async (): Promise<IBookDocument[]> => {
  const books = await Book.find({ isActive: true });
  return books.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

export const getBookBySlug = async (slug: string): Promise<IBookDocument> => {
  const book = await Book.findOne({ slug, isActive: true });
  if (!book) throw err('Libro no encontrado', 404);
  return book;
};
