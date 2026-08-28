import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { Course } from '../atomic/molecules/models/course.model.js';
import { Offer } from '../atomic/molecules/models/offer.model.js';
import { Package } from '../atomic/molecules/models/package.model.js';
import { COURSE_STATUS } from '../atomic/atoms/constants/status.constant.js';

type AcademyOfferSeed = {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  plan: string;
  stripePriceEnv: string;
  packageId: string;
  packageName: string;
};

const academyOffers: AcademyOfferSeed[] = [
  {
    id: 'off_academia_entrepreneur',
    title: 'Academia Entrepreneur',
    slug: 'academia-entrepreneur',
    description: 'Plan anual Entrepreneur de la Academia.',
    price: 4997,
    plan: 'entrepreneur',
    stripePriceEnv: 'STRIPE_PRICE_ACADEMIA_ENTREPRENEUR',
    packageId: 'pkg_academia_entrepreneur',
    packageName: 'Paquete Academia Entrepreneur',
  },
  {
    id: 'off_academia_plus',
    title: 'Academia +',
    slug: 'academia-plus',
    description: 'Plan anual Academia +.',
    price: 14997,
    plan: 'plus',
    stripePriceEnv: 'STRIPE_PRICE_ACADEMIA_PLUS',
    packageId: 'pkg_academia_plus',
    packageName: 'Paquete Academia +',
  },
  {
    id: 'off_academia_master',
    title: 'Academia Master',
    slug: 'academia-master',
    description: 'Plan anual Master de la Academia.',
    price: 49997,
    plan: 'master',
    stripePriceEnv: 'STRIPE_PRICE_ACADEMIA_MASTER',
    packageId: 'pkg_academia_master',
    packageName: 'Paquete Academia Master',
  },
];

const main = async () => {
  await connectDB();
  const allCourses = (await Course.find({})).filter((course) => course.status !== COURSE_STATUS.ARCHIVED);
  for (const course of allCourses) {
    if (course.status !== COURSE_STATUS.PUBLISHED) {
      course.status = COURSE_STATUS.PUBLISHED;
      await course.save();
    }
  }
  const courseIds = allCourses.map((course) => String(course._id));
  const content = courseIds.map((courseId) => ({ courseId, access: 'full' as const, moduleIds: [] }));
  const yearlyExpiresAt = new Date('2027-12-31T23:59:59.999-06:00').toISOString();
  const activeOfferSlugs = new Set(academyOffers.map((seed) => seed.slug));
  const activePackageSlugs = new Set(academyOffers.map((seed) => seed.packageId.replace(/^pkg_/, '').replace(/_/g, '-')));

  for (const staleOffer of (await Offer.find({})).filter((offer) => String(offer.slug || '').startsWith('academia-') && !activeOfferSlugs.has(offer.slug))) {
    staleOffer.status = 'archived';
    await staleOffer.save();
    console.log(`archived stale offer ${staleOffer.slug}`);
  }

  for (const stalePackage of (await Package.find({})).filter((pkg) => String(pkg.slug || '').startsWith('academia-') && !activePackageSlugs.has(pkg.slug))) {
    stalePackage.isActive = false;
    await stalePackage.save();
    console.log(`disabled stale package ${stalePackage.slug}`);
  }

  for (const seed of academyOffers) {
    const packagePayload = {
      _id: seed.packageId,
      id: seed.packageId,
      name: seed.packageName,
      slug: seed.packageId.replace(/^pkg_/, '').replace(/_/g, '-'),
      description: `${seed.packageName}: acceso anual a ${courseIds.length} cursos publicados de Academia.`,
      price: seed.price,
      currency: 'MXN',
      courseIds,
      durationDays: 365,
      expiresAt: yearlyExpiresAt,
      isActive: true,
      isFeatured: seed.plan === 'plus',
    };
    const existingPackage = (await Package.findById(seed.packageId)) ?? (await Package.findOne({ slug: packagePayload.slug }));
    if (existingPackage) {
      Object.assign(existingPackage, packagePayload);
      await existingPackage.save();
      console.log(`updated ${seed.packageId} with ${courseIds.length} courses`);
    } else {
      await Package.create(packagePayload);
      console.log(`created ${seed.packageId} with ${courseIds.length} courses`);
    }

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
      targetType: 'package' as const,
      targetId: seed.packageId,
      content,
      assignedUserIds: existing?.assignedUserIds ?? [],
      startsAt: existing?.startsAt ?? null,
      expiresAt: existing?.expiresAt ?? yearlyExpiresAt,
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
  console.log(`published ${courseIds.length} academy courses`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
