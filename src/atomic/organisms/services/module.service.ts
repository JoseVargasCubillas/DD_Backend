import slugify from 'slugify';
import { Module, IModuleDocument } from '../../molecules/models/module.model.js';
import { Course } from '../../molecules/models/course.model.js';
import { Lesson } from '../../molecules/models/lesson.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

export const listModulesByCourse = async (courseId: string): Promise<IModuleDocument[]> => {
  const mods = await Module.find({ courseId });
  return mods.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

export const createModule = async (courseId: string, input: { title: string; description?: string }): Promise<IModuleDocument> => {
  const course = await Course.findById(courseId);
  if (!course) throw err('Curso no encontrado', 404);
  const existing = await Module.find({ courseId });
  const order = existing.length;
  const mod = await Module.create({
    courseId,
    title: input.title,
    slug: slugify(input.title, { lower: true, strict: true }),
    description: input.description ?? '',
    order,
  });
  course.modules = [...(course.modules ?? []), String(mod._id)];
  await course.save();
  return mod;
};

export const updateModule = async (id: string, data: Partial<IModuleDocument>): Promise<IModuleDocument> => {
  const mod = await Module.findById(id);
  if (!mod) throw err('Módulo no encontrado', 404);
  if (data.title) {
    mod.title = data.title;
    mod.slug = slugify(data.title, { lower: true, strict: true });
  }
  if (data.description !== undefined) mod.description = data.description;
  if (data.order !== undefined) mod.order = data.order;
  if (data.isPublished !== undefined) mod.isPublished = data.isPublished;
  return mod.save();
};

export const deleteModule = async (id: string): Promise<void> => {
  const mod = await Module.findById(id);
  if (!mod) throw err('Módulo no encontrado', 404);
  // remove lessons
  for (const lid of mod.lessonIds ?? []) {
    await Lesson.findByIdAndDelete(lid);
  }
  await Module.findByIdAndDelete(id);
  const course = await Course.findById(mod.courseId);
  if (course) {
    course.modules = (course.modules ?? []).filter((m) => m !== id);
    await course.save();
  }
};

export const reorderModules = async (courseId: string, orderedIds: string[]): Promise<IModuleDocument[]> => {
  await Promise.all(orderedIds.map((id, idx) => Module.findByIdAndUpdate(id, { order: idx })));
  const course = await Course.findById(courseId);
  if (course) {
    course.modules = orderedIds;
    await course.save();
  }
  return listModulesByCourse(courseId);
};

// ── Lecciones dentro de módulos ──────────────────────────────
export const addLessonToModule = async (moduleId: string, input: { title: string; videoUrl?: string; duration?: number; content?: string }) => {
  const mod = await Module.findById(moduleId);
  if (!mod) throw err('Módulo no encontrado', 404);
  const lesson = await Lesson.create({
    title: input.title,
    slug: slugify(input.title, { lower: true, strict: true }),
    course: mod.courseId,
    moduleId,
    order: (mod.lessonIds ?? []).length,
    videoUrl: input.videoUrl ?? '',
    duration: input.duration ?? 0,
    content: input.content ?? '',
  });
  mod.lessonIds = [...(mod.lessonIds ?? []), String(lesson._id)];
  await mod.save();
  return lesson;
};

export const listLessonsByModule = async (moduleId: string) => {
  const lessons = await Lesson.find({ moduleId });
  return lessons.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};
