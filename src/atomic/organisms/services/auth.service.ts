import { User } from '../../molecules/models/user.model.js';
import { hashPassword, comparePassword } from '../../atoms/helpers/hash.helper.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../atoms/helpers/jwt.helper.js';
import { AuthResult } from '../../../types/index.js';

interface RegisterInput { name: string; email: string; password: string }
interface LoginInput { email: string; password: string }

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
