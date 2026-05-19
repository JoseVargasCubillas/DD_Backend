import { ROLES } from '../atomic/atoms/constants/roles.constant.js';
import { PLANS } from '../atomic/atoms/constants/plans.constant.js';
import { COURSE_STATUS, ORDER_STATUS, SUBSCRIPTION_STATUS, EVENT_STATUS } from '../atomic/atoms/constants/status.constant.js';

export type Role = typeof ROLES[keyof typeof ROLES];
export type Plan = typeof PLANS[keyof typeof PLANS];
export type CourseStatus = typeof COURSE_STATUS[keyof typeof COURSE_STATUS];
export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUS[keyof typeof SUBSCRIPTION_STATUS];
export type EventStatus = typeof EVENT_STATUS[keyof typeof EVENT_STATUS];

export interface IUser {
  _id: string;
  name: string;
  email: string;
  role: Role;
  avatar: string;
  phone: string;
  bio: string;
  plan: Plan;
  stripeCustomerId: string;
  enrolledCourses: string[];
  isActive: boolean;
  isEmailVerified: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICourse {
  _id: string;
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  previewVideo: string;
  price: number;
  salePrice?: number;
  currency: string;
  category: string;
  tags: string[];
  level: 'beginner' | 'intermediate' | 'advanced';
  language: string;
  status: CourseStatus;
  instructor: string | IUser;
  lessons: string[] | ILesson[];
  totalDuration: number;
  totalLessons: number;
  enrolledCount: number;
  rating: number;
  isFeatured: boolean;
  requirements: string[];
  whatYouLearn: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILesson {
  _id: string;
  title: string;
  slug: string;
  course: string | ICourse;
  order: number;
  description: string;
  videoUrl: string;
  duration: number;
  content: string;
  resources: { name: string; url: string }[];
  isPreview: boolean;
  isFree: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubscription {
  _id: string;
  user: string | IUser;
  plan: Plan;
  status: SubscriptionStatus;
  stripeSubscriptionId: string;
  stripePriceId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  createdAt: Date;
}

export interface IOrderItem {
  type: 'course' | 'event' | 'subscription' | 'product';
  refId: string;
  title: string;
  price: number;
  quantity: number;
}

export interface IOrder {
  _id: string;
  user: string | IUser;
  items: IOrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: OrderStatus;
  stripePaymentIntentId: string;
  stripeReceiptUrl: string;
  paidAt?: Date;
  createdAt: Date;
}

export interface IEvent {
  _id: string;
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  type: 'seminar' | 'workshop' | 'webinar' | 'conference';
  modality: 'in-person' | 'online' | 'hybrid';
  location: string;
  onlineUrl: string;
  startDate: Date;
  endDate: Date;
  price: number;
  salePrice?: number;
  capacity: number;
  registeredCount: number;
  status: EventStatus;
  instructor: string | IUser;
  attendees: string[];
  isFeatured: boolean;
  agenda: { time: string; topic: string; speaker: string }[];
  createdAt: Date;
}

export interface IBlog {
  _id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  thumbnail: string;
  author: string | IUser;
  category: string;
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  publishedAt?: Date;
  readTime: number;
  viewsCount: number;
  isFeatured: boolean;
  seo: { metaTitle: string; metaDescription: string; keywords: string[] };
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pages: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: Pick<IUser, '_id' | 'name' | 'email' | 'role'>;
}
