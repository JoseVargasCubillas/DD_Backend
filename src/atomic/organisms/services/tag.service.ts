import slugify from 'slugify';
import { Tag, ITagDocument } from '../../molecules/models/tag.model.js';
import { User } from '../../molecules/models/user.model.js';

const makeError = (message: string, statusCode: number): Error =>
  Object.assign(new Error(message), { statusCode });

export const listTags = async (): Promise<ITagDocument[]> =>
  Tag.find({}).sort('name');

export const createTag = async (input: { name: string; color?: string; description?: string }): Promise<ITagDocument> => {
  const name = input.name?.trim();
  if (!name) throw makeError('Nombre requerido', 400);
  const slug = slugify(name, { lower: true, strict: true });
  const exists = await Tag.findOne({ slug });
  if (exists) throw makeError('Ya existe una etiqueta con ese nombre', 409);
  return Tag.create({ name, slug, color: input.color || '#0a0a0a', description: input.description || '' });
};

export const updateTag = async (id: string, input: { name?: string; color?: string; description?: string }): Promise<ITagDocument> => {
  const tag = await Tag.findById(id);
  if (!tag) throw makeError('Etiqueta no encontrada', 404);
  if (input.name) {
    tag.name = input.name.trim();
    tag.slug = slugify(tag.name, { lower: true, strict: true });
  }
  if (input.color) tag.color = input.color;
  if (input.description !== undefined) tag.description = input.description;
  return tag.save();
};

export const deleteTag = async (id: string): Promise<void> => {
  const tag = await Tag.findById(id);
  if (!tag) throw makeError('Etiqueta no encontrada', 404);
  await Tag.findByIdAndDelete(id);
  // remueve la etiqueta de cualquier usuario que la tenía
  const users = await User.find({});
  for (const u of users) {
    if (Array.isArray(u.tagIds) && u.tagIds.includes(id)) {
      u.tagIds = u.tagIds.filter((t) => t !== id);
      await u.save();
    }
  }
};

export const countUsersByTag = async (tagId: string): Promise<number> => {
  const users = await User.find({});
  return users.filter((u) => Array.isArray(u.tagIds) && u.tagIds.includes(tagId)).length;
};
