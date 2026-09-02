import { PLANS } from '../../atoms/constants/plans.constant.js';
import { ROLES } from '../../atoms/constants/roles.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IUserDocument extends SqlDocumentMethods<IUserDocument> {
  name: string;
  email: string;
  password: string;
  role: string;
  avatar: string;
  phone: string;
  bio: string;
  plan: string;
  stripeCustomerId: string;
  enrolledCourses: string[];
  tagIds: string[];
  notes: string;
  contactStatus: 'lead' | 'customer' | 'churned';
  marketingStatus: 'never_subscribed' | 'subscribed' | 'unsubscribed';
  signInCount: number;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifyToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date | string;
  mustChangePassword?: boolean;
  lastLogin?: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const User = createSqlModel<IUserDocument>({
  table: 'users',
  defaults: () => ({
    role: ROLES.USER,
    avatar: '',
    phone: '',
    bio: '',
    plan: PLANS.FREE,
    stripeCustomerId: '',
    enrolledCourses: [],
    tagIds: [],
    notes: '',
    contactStatus: 'lead',
    marketingStatus: 'never_subscribed',
    signInCount: 0,
    isActive: true,
    isEmailVerified: false,
    mustChangePassword: false,
  }),
});
