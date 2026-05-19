import { User, IUserDocument } from '../../molecules/models/user.model.js';

const makeError = (message: string, statusCode: number): Error =>
  Object.assign(new Error(message), { statusCode });

interface ListParams { page?: number; limit?: number; search?: string }

export const getById = async (id: string): Promise<IUserDocument> => {
  const user = await User.findById(id).populate('enrolledCourses', 'title slug thumbnail');
  if (!user) throw makeError('User not found', 404);
  return user;
};

export const updateProfile = async (id: string, data: Partial<IUserDocument>): Promise<IUserDocument | null> => {
  const allowed: (keyof IUserDocument)[] = ['name', 'phone', 'bio', 'avatar'] as any;
  const updates = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k as any)));
  return User.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

export const listUsers = async ({ page = 1, limit = 20, search = '' }: ListParams) => {
  const query = search ? { $text: { $search: search } } : {};
  const [users, total] = await Promise.all([
    User.find(query).skip((page - 1) * limit).limit(limit).sort('-createdAt'),
    User.countDocuments(query),
  ]);
  return { users, total, page, pages: Math.ceil(total / limit) };
};

export const toggleActive = async (id: string): Promise<IUserDocument> => {
  const user = await User.findById(id);
  if (!user) throw makeError('User not found', 404);
  user.isActive = !user.isActive;
  return user.save();
};
