import mongoose, { Document, Schema } from 'mongoose';
import { ROLES } from '../../atoms/constants/roles.constant.js';
import { PLANS } from '../../atoms/constants/plans.constant.js';

export interface IUserDocument extends Document {
  name: string;
  email: string;
  password: string;
  role: string;
  avatar: string;
  phone: string;
  bio: string;
  plan: string;
  stripeCustomerId: string;
  enrolledCourses: mongoose.Types.ObjectId[];
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifyToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUserDocument>({
  name:               { type: String, required: true, trim: true },
  email:              { type: String, required: true, unique: true, lowercase: true },
  password:           { type: String, required: true, select: false },
  role:               { type: String, enum: Object.values(ROLES), default: ROLES.USER },
  avatar:             { type: String, default: '' },
  phone:              { type: String, default: '' },
  bio:                { type: String, default: '' },
  plan:               { type: String, enum: Object.values(PLANS), default: PLANS.FREE },
  stripeCustomerId:   { type: String, default: '' },
  enrolledCourses:    [{ type: Schema.Types.ObjectId, ref: 'Course' }],
  isActive:           { type: Boolean, default: true },
  isEmailVerified:    { type: Boolean, default: false },
  emailVerifyToken:   String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  lastLogin:          Date,
}, { timestamps: true });

export const User = mongoose.model<IUserDocument>('User', userSchema);
