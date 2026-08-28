import slugify from 'slugify';
import { Course, ICourseDocument } from '../../molecules/models/course.model.js';
import { Lesson } from '../../molecules/models/lesson.model.js';
import { Module } from '../../molecules/models/module.model.js';
import { Offer, IOfferContentItem, IOfferDocument } from '../../molecules/models/offer.model.js';
import { Package } from '../../molecules/models/package.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { COURSE_STATUS, SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';

const makeError = (message: string, statusCode: number): Error =>
  Object.assign(new Error(message), { statusCode });

const makeSlug = (value: string): string =>
  slugify(value, { lower: true, strict: true }) || `oferta-${Date.now()}`;

const unique = (values: string[]): string[] =>
  Array.from(new Set(values.map(String).filter(Boolean)));

const normalizeDate = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw makeError('Fecha inválida', 400);
  return date.toISOString();
};

const isOfferActive = (offer: IOfferDocument): boolean => {
  if (offer.status !== 'published') return false;
  const now = Date.now();
  if (offer.startsAt && new Date(String(offer.startsAt)).getTime() > now) return false;
  if (offer.expiresAt && new Date(String(offer.expiresAt)).getTime() < now) return false;
  return true;
};

const normalizeContent = async (content: IOfferContentItem[] = []): Promise<IOfferContentItem[]> => {
  const normalized: IOfferContentItem[] = [];
  for (const item of content) {
    const courseId = String(item.courseId || '');
    if (!courseId) continue;
    const course = await Course.findById(courseId);
    if (!course) throw makeError(`Curso no encontrado: ${courseId}`, 400);

    const access = item.access === 'modules' ? 'modules' : 'full';
    const moduleIds = access === 'modules' ? unique(item.moduleIds ?? []) : [];
    if (access === 'modules') {
      for (const moduleId of moduleIds) {
        const module = await Module.findById(moduleId);
        if (!module || String(module.courseId) !== courseId) {
          throw makeError(`Modulo no valido para el curso: ${moduleId}`, 400);
        }
      }
    }
    normalized.push({ courseId, access, moduleIds });
  }
  if (!normalized.length) throw makeError('La oferta necesita al menos un curso o modulo', 400);
  return normalized;
};

const normalizeOfferTarget = async (
  input: Partial<IOfferDocument>,
): Promise<{ targetType: 'course' | 'package' | 'product'; targetId: string; content: IOfferContentItem[] }> => {
  const targetType = input.targetType === 'package' || input.targetType === 'product' ? input.targetType : 'course';
  const targetId = String(input.targetId || '').trim();

  if (targetType === 'package') {
    if (!targetId) throw makeError('Selecciona un paquete para la oferta', 400);
    const pkg = await Package.findById(targetId);
    if (!pkg) throw makeError('Paquete no encontrado', 400);
    const content = await normalizeContent(
      (pkg.courseIds ?? []).map((courseId) => ({ courseId, access: 'full', moduleIds: [] })),
    );
    return { targetType, targetId, content };
  }

  const content = await normalizeContent(input.content ?? []);
  const firstCourseId = content[0]?.courseId ?? '';
  return {
    targetType,
    targetId: targetId || firstCourseId,
    content,
  };
};

export const listOffers = async () => {
  const offers = await Offer.find({ status: { $ne: 'archived' } });
  return offers.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

export const getOffer = async (id: string): Promise<IOfferDocument> => {
  const offer = await Offer.findById(id);
  if (!offer) throw makeError('Offer not found', 404);
  return offer;
};

export const createOffer = async (input: Partial<IOfferDocument>): Promise<IOfferDocument> => {
  const title = String(input.title || '').trim();
  if (!title) throw makeError('Titulo requerido', 400);
  const slug = makeSlug(title);
  const existing = await Offer.findOne({ slug });
  if (existing) throw makeError('Ya existe una oferta con ese titulo', 409);
  const target = await normalizeOfferTarget(input);
  return Offer.create({
    title,
    slug,
    description: String(input.description ?? ''),
    type: input.type === 'trial' ? 'trial' : 'standard',
    status: input.status === 'published' ? 'published' : 'draft',
    price: Number(input.price ?? 0),
    currency: String(input.currency || 'MXN'),
    paymentType: input.paymentType || 'one_time',
    stripePriceId: String(input.stripePriceId || ''),
    plan: String(input.plan || 'pro'),
    targetType: target.targetType,
    targetId: target.targetId,
    content: target.content,
    assignedUserIds: unique(input.assignedUserIds ?? []),
    startsAt: normalizeDate(input.startsAt),
    expiresAt: normalizeDate(input.expiresAt),
  } as Partial<IOfferDocument>);
};

export const updateOffer = async (id: string, input: Partial<IOfferDocument>): Promise<IOfferDocument> => {
  const offer = await getOffer(id);
  if (input.title) {
    offer.title = String(input.title).trim();
    offer.slug = makeSlug(offer.title);
  }
  if (input.description !== undefined) offer.description = String(input.description ?? '');
  if (input.type) offer.type = input.type === 'trial' ? 'trial' : 'standard';
  if (input.status) offer.status = ['draft', 'published', 'archived'].includes(input.status) ? input.status : offer.status;
  if (input.price !== undefined) offer.price = Number(input.price ?? 0);
  if (input.currency) offer.currency = String(input.currency);
  if (input.paymentType !== undefined) offer.paymentType = input.paymentType;
  if (input.stripePriceId !== undefined) offer.stripePriceId = String(input.stripePriceId || '');
  if (input.plan !== undefined) offer.plan = String(input.plan || 'pro');
  if (input.targetType !== undefined || input.targetId !== undefined || input.content) {
    const target = await normalizeOfferTarget({ ...offer, ...input });
    offer.targetType = target.targetType;
    offer.targetId = target.targetId;
    offer.content = target.content;
  }
  if (input.assignedUserIds) offer.assignedUserIds = unique(input.assignedUserIds);
  if (input.startsAt !== undefined) offer.startsAt = normalizeDate(input.startsAt);
  if (input.expiresAt !== undefined) offer.expiresAt = normalizeDate(input.expiresAt);
  return offer.save();
};

export const deleteOffer = async (id: string): Promise<IOfferDocument> => {
  const offer = await getOffer(id);
  offer.status = 'archived';
  return offer.save();
};

export const assignOffer = async (offerId: string, userIds: string[]): Promise<IOfferDocument> => {
  const offer = await getOffer(offerId);
  const next = new Set(offer.assignedUserIds ?? []);
  for (const userId of unique(userIds)) {
    const user = await User.findById(userId);
    if (!user) throw makeError(`Cliente no encontrado: ${userId}`, 400);
    next.add(userId);
  }
  offer.assignedUserIds = Array.from(next);
  return offer.save();
};

export const revokeOffer = async (offerId: string, userId: string): Promise<IOfferDocument> => {
  const offer = await getOffer(offerId);
  offer.assignedUserIds = (offer.assignedUserIds ?? []).filter((id) => id !== userId);
  return offer.save();
};

export interface CourseAccess {
  fullCourseIds: Set<string>;
  moduleIdsByCourse: Map<string, Set<string>>;
}

export const getUserCourseAccess = async (userId: string): Promise<CourseAccess> => {
  const user = await User.findById(userId);
  if (!user) throw makeError('User not found', 404);
  const fullCourseIds = new Set((user.enrolledCourses ?? []).map(String));
  const moduleIdsByCourse = new Map<string, Set<string>>();

  const activeSubscription = await Subscription.findOne({ user: userId, status: SUBSCRIPTION_STATUS.ACTIVE })
    ?? await Subscription.findOne({ user: userId, status: SUBSCRIPTION_STATUS.TRIALING });

  const subscriptionIsCurrent =
    activeSubscription &&
    (!activeSubscription.currentPeriodEnd || new Date(String(activeSubscription.currentPeriodEnd)).getTime() >= Date.now());

  if (subscriptionIsCurrent) {
    const packageId = String((activeSubscription as any).packageId || '');
    const pkg = packageId ? await Package.findById(packageId) : null;
    if (pkg?.courseIds?.length) {
      pkg.courseIds.forEach((courseId) => fullCourseIds.add(String(courseId)));
    } else {
      const academyCourses = await Course.find({});
      academyCourses
        .filter((course) => course.status !== COURSE_STATUS.ARCHIVED)
        .forEach((course) => fullCourseIds.add(course._id));
    }
  }

  const offers = (await Offer.find({})).filter((offer) => (offer.assignedUserIds ?? []).includes(userId) && isOfferActive(offer));
  for (const offer of offers) {
    for (const item of offer.content ?? []) {
      if (item.access === 'full') {
        fullCourseIds.add(item.courseId);
        continue;
      }
      const moduleSet = moduleIdsByCourse.get(item.courseId) ?? new Set<string>();
      for (const moduleId of item.moduleIds ?? []) moduleSet.add(moduleId);
      moduleIdsByCourse.set(item.courseId, moduleSet);
    }
  }

  return { fullCourseIds, moduleIdsByCourse };
};

export const getUserOffers = async (userId: string): Promise<IOfferDocument[]> => {
  const offers = await Offer.find({});
  return offers.filter((offer) => (offer.assignedUserIds ?? []).includes(userId) && offer.status !== 'archived');
};

export const getEffectiveUserCourses = async (userId: string): Promise<ICourseDocument[]> => {
  const access = await getUserCourseAccess(userId);
  const ids = unique([...access.fullCourseIds, ...access.moduleIdsByCourse.keys()]);
  const courses = await Promise.all(ids.map((id) => Course.findById(id)));
  return (courses.filter(Boolean) as ICourseDocument[]).map((course) => {
    const partialModules = access.moduleIdsByCourse.get(course._id);
    if (access.fullCourseIds.has(course._id) || !partialModules) return course;
    return {
      ...course,
      modules: Array.from(partialModules),
      totalLessons: 0,
    } as ICourseDocument;
  });
};

export const applyAccessToCourse = async (course: ICourseDocument, userId?: string) => {
  const modules = await Module.find({ courseId: course._id });
  modules.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const allLessons = await Lesson.find({ course: course._id });
  allLessons.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!userId) return { ...course, lessons: allLessons, modules };

  const access = await getUserCourseAccess(userId);
  if (access.fullCourseIds.has(course._id)) return { ...course, lessons: allLessons, modules };

  const allowedModules = access.moduleIdsByCourse.get(course._id);
  if (!allowedModules) return { ...course, lessons: [], modules: [] };

  const filteredModules = modules.filter((module) => allowedModules.has(module._id));
  const allowedModuleIds = new Set(filteredModules.map((module) => module._id));
  const filteredLessons = allLessons.filter((lesson) => allowedModuleIds.has(String((lesson as any).moduleId)));
  return {
    ...course,
    lessons: filteredLessons,
    modules: filteredModules,
    totalLessons: filteredLessons.length,
  };
};
