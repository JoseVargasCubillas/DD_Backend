// Fuente única de verdad para los libros "de catálogo" (los que vende la web
// de forma fija, no los que se dan de alta libremente desde el admin).
// La sembramos aquí en vez de solo en el script de seed porque el seed es un
// paso manual que puede no haberse corrido nunca contra una base de datos
// nueva o reseteada — book.service.ts usa este mismo catálogo para
// autocrear el registro si falta, así el checkout de Stripe nunca truena
// con un 404 por falta de un paso operativo.
export type BookCatalogEntry = {
  id: string;
  title: string;
  slug: string;
  subtitle: string;
  description: string;
  price: number;
  shippingCost: number;
  format: string;
  pages: number;
  language: string;
  year: number;
  stock: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export const BOOK_CATALOG: BookCatalogEntry[] = [
  {
    id: 'book_7_claves_cobrar',
    title: '7 claves para cobrar a tu empresa',
    slug: '7-claves-para-cobrar-a-tu-empresa',
    subtitle: '7 claves para cobrar a tu empresa.',
    description:
      'Guía práctica para dueños de negocio sobre cómo cobrarle correctamente a su propia empresa sin comprometer su estructura fiscal.',
    price: 497,
    shippingCost: 0,
    format: 'Pasta blanda',
    pages: 312,
    language: 'Español',
    year: 2024,
    stock: 500,
    weightKg: 0.45,
    lengthCm: 23,
    widthCm: 16,
    heightCm: 2.5,
  },
  {
    id: 'book_7_secretos_sat',
    title: 'Los 7 secretos que el SAT no quiere que conozcas',
    slug: '7-secretos-sat',
    subtitle: 'Que el SAT no quiere que conozcas.',
    description:
      'El libro más vendido de Diego sobre los puntos ciegos, mitos y herramientas que el empresario mexicano debe entender antes de una revisión.',
    price: 497,
    shippingCost: 0,
    format: 'Pasta dura',
    pages: 328,
    language: 'Español',
    year: 2021,
    stock: 0,
    weightKg: 0.65,
    lengthCm: 23,
    widthCm: 16,
    heightCm: 3.5,
  },
  {
    id: 'book_7_secretos_fiscalista',
    title: '7 Secretos de un fiscalista',
    slug: '7-secretos-fiscalista',
    subtitle: 'La mentalidad detrás de la estrategia fiscal moderna.',
    description:
      'Diego comparte cómo piensa, cómo decide y cómo construye estrategia un fiscalista mexicano que asesora a empresas medianas y grandes.',
    price: 497,
    shippingCost: 0,
    format: 'Pasta dura',
    pages: 348,
    language: 'Español',
    year: 2024,
    stock: 250,
    weightKg: 0.65,
    lengthCm: 23,
    widthCm: 16,
    heightCm: 3.5,
  },
  {
    id: 'book_bundle_tres_libros',
    title: 'Bundle · 2 libros + lista de espera (caja firmada)',
    slug: 'bundle-tres-libros',
    subtitle: 'La biblioteca del estratega fiscal, en una sola caja.',
    description:
      'Dos libros de Diego Díaz — 7 Claves para cobrar a tu empresa y 7 Secretos de un fiscalista — en caja de lino impresa, con dedicatoria firmada por Diego a quien tú elijas. Los 7 secretos que el SAT no quiere que conozcas está agotado: al comprar el bundle te anotamos automáticamente en la lista de espera de su reimpresión 2026, sin costo adicional, y te lo enviamos en cuanto esté disponible.',
    price: 750,
    shippingCost: 0,
    format: 'Caja de lino · edición especial',
    pages: 660,
    language: 'Español',
    year: 2024,
    stock: 100,
    weightKg: 1.3,
    lengthCm: 24,
    widthCm: 18,
    heightCm: 6,
  },
];

export const findBookCatalogEntry = (slug: string): BookCatalogEntry | undefined =>
  BOOK_CATALOG.find((entry) => entry.slug === slug);
