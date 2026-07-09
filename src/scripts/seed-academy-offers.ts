import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { Course } from '../atomic/molecules/models/course.model.js';
import { Offer } from '../atomic/molecules/models/offer.model.js';

type AcademyOfferSeed = {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  plan: string;
  stripePriceEnv: string;
};

const academyOffers: AcademyOfferSeed[] = [
  {
    id: 'off_academia_entrepreneur',
    title: 'Academia Entrepreneur',
    slug: 'academia-entrepreneur',
    description: 'Plan mensual Entrepreneur de la Academia.',
    price: 4997,
    plan: 'entrepreneur',
    stripePriceEnv: 'STRIPE_PRICE_ACADEMIA_ENTREPRENEUR',
  },
  {
    id: 'off_academia_plus',
    title: 'Academia +',
    slug: 'academia-plus',
    description: 'Plan mensual Academia +.',
    price: 14997,
    plan: 'plus',
    stripePriceEnv: 'STRIPE_PRICE_ACADEMIA_PLUS',
  },
  {
    id: 'off_academia_master',
    title: 'Academia Master',
    slug: 'academia-master',
    description: 'Plan mensual Master de la Academia.',
    price: 49997,
    plan: 'master',
    stripePriceEnv: 'STRIPE_PRICE_ACADEMIA_MASTER',
  },
];

const main = async () => {
  await connectDB();
  const [course] = await Course.find({ status: 'published' });
  const content = course ? [{ courseId: course._id, access: 'full' as const, moduleIds: [] }] : [];

  for (const seed of academyOffers) {
    const existing = (await Offer.findById(seed.id)) ?? (await Offer.findOne({ slug: seed.slug }));
    const stripePriceId = process.env[seed.stripePriceEnv] || String((existing as any)?.stripePriceId || '');
    const payload = {
      _id: seed.id,
      id: seed.id,
      title: seed.title,
      slug: seed.slug,
      description: seed.description,
      type: 'standard' as const,
      status: 'published' as const,
      price: seed.price,
      currency: 'MXN',
      paymentType: 'subscription' as const,
      stripePriceId,
      plan: seed.plan,
      content: (existing?.content?.length ? existing.content : content),
      assignedUserIds: existing?.assignedUserIds ?? [],
      startsAt: existing?.startsAt ?? null,
      expiresAt: existing?.expiresAt ?? null,
    };

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
      console.log(`updated ${seed.id}${stripePriceId ? ' with stripe price' : ' without stripe price'}`);
    } else {
      await Offer.create(payload);
      console.log(`created ${seed.id}${stripePriceId ? ' with stripe price' : ' without stripe price'}`);
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });