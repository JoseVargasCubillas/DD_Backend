import crypto from 'node:crypto';
import { User } from '../../molecules/models/user.model.js';
import { Course } from '../../molecules/models/course.model.js';
import { hashPassword, comparePassword, generateTempPassword } from '../../atoms/helpers/hash.helper.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../atoms/helpers/jwt.helper.js';
import { AuthResult } from '../../../types/index.js';
import { sendCredentials, sendPasswordReset } from './email.service.js';
import { env } from '../../../config/env.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora, debe coincidir con el texto del correo

const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

interface RegisterInput { name: string; email: string; password: string }
interface LoginInput { email: string; password: string }
interface AdminCreateUserInput {
  name: string;
  email: string;
  role?: 'user' | 'admin';
  tagIds?: string[];
  courseIds?: string[];
  marketingStatus?: 'never_subscribed' | 'subscribed' | 'unsubscribed';
}

const makeError = (message: string, statusCode: number): Error =>
  Object.assign(new Error(message), { statusCode });

export const register = async ({ name, email, password }: RegisterInput): Promise<AuthResult> => {
  const exists = await User.findOne({ email });
  if (exists) throw makeError('Email already in use', 409);

  const hashed = await hashPassword(password);
  const user = await User.create({ name, email, password: hashed });
  return {
    user: { _id: String(user._id), name: user.name, email: user.email, role: user.role as any },
    accessToken: signAccessToken({ id: String(user._id), role: user.role }),
    refreshToken: signRefreshToken({ id: String(user._id) }),
  };
};

export const login = async ({ email, password }: LoginInput): Promise<AuthResult> => {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await comparePassword(password, user.password)))
    throw makeError('Invalid credentials', 401);

  user.lastLogin = new Date();
  await user.save();

  return {
    user: { _id: String(user._id), name: user.name, email: user.email, role: user.role as any },
    accessToken: signAccessToken({ id: String(user._id), role: user.role }),
    refreshToken: signRefreshToken({ id: String(user._id) }),
  };
};

export const refreshTokens = async (token: string): Promise<{ accessToken: string; refreshToken: string }> => {
  const decoded = verifyRefreshToken(token);
  const user = await User.findById(decoded.id);
  if (!user || !user.isActive) throw makeError('Invalid token', 401);
  return {
    accessToken: signAccessToken({ id: String(user._id), role: user.role }),
    refreshToken: signRefreshToken({ id: String(user._id) }),
  };
};

/**
 * Admin: crea una cuenta de cliente y envía credenciales por correo.
 * Devuelve la temporal solo en development para verificación.
 */
export const adminCreateUser = async ({
  name,
  email,
  role = 'user',
  tagIds = [],
  courseIds = [],
  marketingStatus = 'never_subscribed',
}: AdminCreateUserInput) => {
  const exists = await User.findOne({ email });
  if (exists) throw makeError('Email already in use', 409);

  const tempPassword = generateTempPassword();
  const hashed = await hashPassword(tempPassword);
  const validCourseIds: string[] = [];

  for (const courseId of Array.from(new Set(courseIds))) {
    const course = await Course.findById(courseId);
    if (!course) continue;
    course.enrolledCount = Number(course.enrolledCount ?? 0) + 1;
    await course.save();
    validCourseIds.push(courseId);
  }

  const user = await User.create({
    name,
    email,
    password: hashed,
    role,
    tagIds: Array.from(new Set(tagIds)),
    enrolledCourses: validCourseIds,
    contactStatus: validCourseIds.length ? 'customer' : 'lead',
    marketingStatus,
    isActive: true,
    isEmailVerified: true,
  });

  // Envío de correo (best effort — no romper la creación si SMTP falla).
  try {
    await sendCredentials({ name: user.name, email: user.email }, tempPassword, { isNew: true });
  } catch (err) {
    console.warn('[adminCreateUser] email send failed:', (err as Error).message);
  }

  return {
    user: { _id: String(user._id), name: user.name, email: user.email, role: user.role },
    // expón la contraseña temporal solo en development
    tempPassword: env.nodeEnv === 'development' ? tempPassword : undefined,
  };
};

/**
 * Solicita el restablecimiento de contraseña: genera un token de un solo uso
 * (se guarda hasheado, se envía en claro por correo) y dispara el email.
 * Nunca lanza error por "usuario no encontrado" — evita filtrar qué correos
 * existen en la base. El controller siempre responde con un mensaje genérico.
 */
export const forgotPassword = async (email: string): Promise<void> => {
  const user = await User.findOne({ email });
  if (!user) return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = hashToken(rawToken);
  user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await user.save();

  const resetUrl = `${env.clientUrl}/restablecer-contrasena?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  try {
    await sendPasswordReset(user, resetUrl);
  } catch (err) {
    console.warn('[forgotPassword] email send failed:', (err as Error).message);
  }
};

interface ResetPasswordInput { token: string; email: string; password: string }

export const resetPassword = async ({ token, email, password }: ResetPasswordInput): Promise<void> => {
  const user = await User.findOne({ email, resetPasswordToken: hashToken(token) });
  const expiresAt = user?.resetPasswordExpires ? new Date(user.resetPasswordExpires).getTime() : 0;

  if (!user || !expiresAt || Date.now() > expiresAt) {
    throw makeError('El enlace no es válido o ya expiró. Solicita uno nuevo.', 400);
  }

  user.password = await hashPassword(password);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();
};
