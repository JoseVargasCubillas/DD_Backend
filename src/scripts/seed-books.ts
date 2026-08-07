import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { Book } from '../atomic/molecules/models/book.model.js';

type BookSeed = {
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
};

const books: BookSeed[] = [
  {
    id: 'book_7_claves_cobrar',
    title: '7 claves para cobrar a tu empresa',
    slug: '7-claves-para-cobrar-a-tu-empresa',
    subtitle: '7 claves para cobrar a tu empresa.',
    description: 'Guía práctica para dueños de negocio sobre cómo cobrarle correctamente a su propia empresa sin comprometer su estructura fiscal.',
    price: 497,
    shippingCost: 0,
    format: 'Pasta blanda',
    pages: 312,
    language: 'Español',
    year: 2024,
    stock: 500,
  },
  {
    id: 'book_7_secretos_sat',
    title: 'Los 7 secretos que el SAT no quiere que conozcas',
    slug: '7-secretos-sat',
    subtitle: 'Que el SAT no quiere que conozcas.',
    description: 'El libro más vendido de Diego sobre los puntos ciegos, mitos y herramientas que el empresario mexicano debe entender antes de una revisión.',
    price: 420,
    shippingCost: 0,
    format: 'Pasta dura',
    pages: 328,
    language: 'Español',
    year: 2021,
    stock: 0,
  },
  {
    id: 'book_7_secretos_fiscalista',
    title: '7 Secretos de un fiscalista',
    slug: '7-secretos-fiscalista',
    subtitle: 'La mentalidad detrás de la estrategia fiscal moderna.',
    description: 'Diego comparte cómo piensa, cómo decide y cómo construye estrategia un fiscalista mexicano que asesora a empresas medianas y grandes.',
    price: 520,
    shippingCost: 0,
    format: 'Pasta dura',
    pages: 348,
    language: 'Español',
    year: 2024,
    stock: 250,
  },
];

const main = async () => {
  await connectDB();

  for (const seed of books) {
    const existing = (await Book.findById(seed.id)) ?? (await Book.findOne({ slug: seed.slug }));
    const payload = {
      _id: seed.id,
      id: seed.id,
      title: seed.title,
      slug: seed.slug,
      subtitle: seed.subtitle,
      author: 'Diego Díaz',
      description: seed.description,
      price: seed.price,
      shippingCost: seed.shippingCost,
      currency: 'MXN',
      format: seed.format,
      pages: seed.pages,
      language: seed.language,
      year: seed.year,
      coverImage: existing?.coverImage ?? '',
      stock: seed.stock,
      isActive: true,
    };

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
      console.log(`updated ${seed.id}`);
    } else {
      await Book.create(payload);
      console.log(`created ${seed.id}`);
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
