import { Book, IBookDocument } from '../../molecules/models/book.model.js';
import { findBookCatalogEntry } from '../../molecules/models/book-catalog.constant.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

export const listBooks = async (): Promise<IBookDocument[]> => {
  const books = await Book.find({ isActive: true });
  return books.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

// Los libros "de catálogo" (ver book-catalog.constant.ts) deben existir en la
// DB para que el checkout de Stripe los pueda cotizar/cobrar, pero ese
// registro normalmente se crea con el script de seed — un paso manual que
// puede saltarse (deploy nuevo, DB reseteada, etc.) y deja el checkout
// tirando 404 aunque el código esté bien. Si no se encuentra pero el slug
// coincide con el catálogo conocido, lo creamos aquí mismo con los datos
// autoritativos para que la compra nunca dependa de correr el seed a mano.
const createFromCatalogIfKnown = async (slug: string): Promise<IBookDocument | null> => {
  const entry = findBookCatalogEntry(slug);
  if (!entry) return null;

  return Book.create({
    _id: entry.id,
    id: entry.id,
    title: entry.title,
    slug: entry.slug,
    subtitle: entry.subtitle,
    author: 'Diego Díaz',
    description: entry.description,
    price: entry.price,
    shippingCost: entry.shippingCost,
    currency: 'MXN',
    format: entry.format,
    pages: entry.pages,
    language: entry.language,
    year: entry.year,
    coverImage: '',
    stock: entry.stock,
    isActive: true,
    weightKg: entry.weightKg,
    lengthCm: entry.lengthCm,
    widthCm: entry.widthCm,
    heightCm: entry.heightCm,
  } as Partial<IBookDocument>);
};

export const getBookBySlug = async (slug: string): Promise<IBookDocument> => {
  const book = (await Book.findOne({ slug, isActive: true })) ?? (await createFromCatalogIfKnown(slug));
  if (!book) throw err('Libro no encontrado', 404);
  return book;
};
