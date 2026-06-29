import { User } from '../../molecules/models/user.model.js';
import { Course } from '../../molecules/models/course.model.js';
import { hashPassword, comparePassword } from '../../atoms/helpers/hash.helper.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../atoms/helpers/jwt.helper.js';
import { AuthResult } from '../../../types/index.js';
import { sendWelcome } from './email.service.js';
import { env } from '../../../config/env.js';

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

// Genera una contraseña temporal segura (16 chars alfanuméricos + símbolos seguros para email).
const generateTempPassword = (length = 14): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
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
    const html = `
      <h1>Hola ${user.name},</h1>
      <p>Tu cuenta de la <strong>Academia Diego Díaz</strong> está lista.</p>
      <p><strong>Correo:</strong> ${user.email}<br />
         <strong>Contraseña temporal:</strong> <code>${tempPassword}</code></p>
      <p>Inicia sesión en <a href="${env.clientUrl}/iniciar-sesion">${env.clientUrl}/iniciar-sesion</a>
         y cámbiala desde tu perfil al primer ingreso.</p>
    `;
    await (await import('nodemailer')).default
      .createTransport({ host: env.mail.host, port: env.mail.port, auth: { user: env.mail.user, pass: env.mail.pass } })
      .sendMail({ from: env.mail.from, to: user.email, subject: 'Acceso a la Academia Diego Díaz', html });
  } catch (err) {
    console.warn('[adminCreateUser] email send failed:', (err as Error).message);
  }

  return {
    user: { _id: String(user._id), name: user.name, email: user.email, role: user.role },
    // expón la contraseña temporal solo en development
    tempPassword: env.nodeEnv === 'development' ? tempPassword : undefined,
  };
};
