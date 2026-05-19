import slugify from 'slugify';
import { Blog, IBlogDocument } from '../../molecules/models/blog.model.js';

export const createPost = async (data: Partial<IBlogDocument>): Promise<IBlogDocument> => {
  const slug = slugify(data.title as string, { lower: true, strict: true });
  const readTime = Math.ceil((data.content as string).split(' ').length / 200);
  return Blog.create({ ...data, slug, readTime });
};

export const listPosts = async ({ page = 1, limit = 10, category = '', search = '', status = 'published' } = {}) => {
  const query: Record<string, unknown> = { status };
  if (category) query.category = category;
  if (search) query.$text = { $search: search };

  const [posts, total] = await Promise.all([
    Blog.find(query).populate('author', 'name avatar').skip((page - 1) * limit).limit(limit).sort('-publishedAt'),
    Blog.countDocuments(query),
  ]);
  return { posts, total, page, pages: Math.ceil(total / limit) };
};

export const getPostBySlug = async (slug: string): Promise<IBlogDocument> => {
  const post = await Blog.findOneAndUpdate({ slug }, { $inc: { viewsCount: 1 } }, { new: true }).populate('author', 'name avatar');
  if (!post) throw Object.assign(new Error('Post not found'), { statusCode: 404 });
  return post;
};

export const updatePost = async (id: string, data: Partial<IBlogDocument>): Promise<IBlogDocument | null> => {
  if (data.title) (data as any).slug = slugify(data.title, { lower: true, strict: true });
  if (data.content) (data as any).readTime = Math.ceil(data.content.split(' ').length / 200);
  return Blog.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

export const deletePost = async (id: string): Promise<IBlogDocument | null> =>
  Blog.findByIdAndUpdate(id, { status: 'archived' }, { new: true });
