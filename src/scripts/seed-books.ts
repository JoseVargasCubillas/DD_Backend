import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { Book } from '../atomic/molecules/models/book.model.js';
import { BOOK_CATALOG } from '../atomic/molecules/models/book-catalog.constant.js';

const main = async () => {
  await connectDB();

  for (const seed of BOOK_CATALOG) {
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
      weightKg: seed.weightKg,
      lengthCm: seed.lengthCm,
      widthCm: seed.widthCm,
      heightCm: seed.heightCm,
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
