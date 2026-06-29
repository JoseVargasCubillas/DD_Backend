import slugify from 'slugify';
import { Course } from '../../molecules/models/course.model.js';
import { Module } from '../../molecules/models/module.model.js';
import { Lesson } from '../../molecules/models/lesson.model.js';
import { COURSE_STATUS } from '../../atoms/constants/status.constant.js';
import { env } from '../../../config/env.js';

interface DriveResourceInput {
  name: string;
  url: string;
}

interface DriveLessonInput {
  title: string;
  videoUrl?: string;
  resources?: DriveResourceInput[];
}

interface DriveModuleInput {
  title: string;
  lessons: DriveLessonInput[];
  resources?: DriveResourceInput[];
}

interface DriveCourseInput {
  title: string;
  description?: string;
  modules: DriveModuleInput[];
}

interface ImportInput {
  courses: DriveCourseInput[];
  instructor: string;
  status?: string;
  includeEmptyModules?: boolean;
}

interface ImportResult {
  createdCourses: number;
  updatedCourses: number;
  createdModules: number;
  createdLessons: number;
  skippedLessons: number;
}

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
}

interface DriveListResponse {
  files?: DriveApiFile[];
  error?: { message?: string };
}

interface DriveFolderImportInput {
  folderUrl: string;
  instructor: string;
  status?: string;
}

const makeSlug = (title: string): string => slugify(title, { lower: true, strict: true });

const asArray = <T>(value: T[] | undefined): T[] => Array.isArray(value) ? value : [];

const sortByName = <T extends { name?: string; title?: string }>(items: T[]): T[] => {
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  return [...items].sort((left, right) => collator.compare(left.name ?? left.title ?? '', right.name ?? right.title ?? ''));
};

const extractDriveFolderId = (value: string): string => {
  const raw = String(value || '').trim();
  const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];

  const queryMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  throw Object.assign(new Error('folderUrl no contiene un ID valido de Drive'), { statusCode: 400 });
};

const trimVideoExtension = (name: string): string => name.replace(/\.(mp4|mov|m4v|webm)$/i, '').trim();

const drivePreviewUrl = (fileId: string): string => `https://drive.google.com/file/d/${fileId}/preview`;

const isFolder = (file: DriveApiFile): boolean => file.mimeType === 'application/vnd.google-apps.folder';

const isVideo = (file: DriveApiFile): boolean => file.mimeType.startsWith('video/');

const listDriveFolder = async (folderId: string): Promise<DriveApiFile[]> => {
  if (!env.googleDrive.apiKey) {
    throw Object.assign(new Error('Falta GOOGLE_DRIVE_API_KEY en el backend'), { statusCode: 500 });
  }

  const params = new URLSearchParams({
    key: env.googleDrive.apiKey,
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType)',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const payload = await response.json().catch(() => ({})) as DriveListResponse;

  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || 'No se pudo leer la carpeta de Drive'), { statusCode: response.status });
  }

  return sortByName(payload.files ?? []);
};

const collectVideosDeep = async (folderId: string, depth = 0): Promise<DriveLessonInput[]> => {
  if (depth > 4) return [];

  const items = await listDriveFolder(folderId);
  const directVideos = sortByName(items.filter(isVideo)).map((file) => ({
    title: trimVideoExtension(file.name),
    videoUrl: drivePreviewUrl(file.id),
  }));

  const nested = await Promise.all(
    sortByName(items.filter(isFolder)).map(async (folder) => collectVideosDeep(folder.id, depth + 1)),
  );

  return [...directVideos, ...nested.flat()];
};

const buildCourseFromDriveFolder = async (folder: DriveApiFile): Promise<DriveCourseInput> => {
  const items = await listDriveFolder(folder.id);
  const directVideos = sortByName(items.filter(isVideo));
  const childFolders = sortByName(items.filter(isFolder));
  const modules: DriveModuleInput[] = [];

  if (directVideos.length > 0) {
    modules.push({
      title: folder.name,
      lessons: directVideos.map((file) => ({
        title: trimVideoExtension(file.name),
        videoUrl: drivePreviewUrl(file.id),
      })),
    });
  }

  const childModules = await Promise.all(
    childFolders.map(async (childFolder) => ({
      title: childFolder.name,
      lessons: await collectVideosDeep(childFolder.id),
    })),
  );

  modules.push(...childModules);

  return {
    title: folder.name.trim(),
    description: `Contenido importado desde Google Drive para ${folder.name.trim()}.`,
    modules,
  };
};

export const buildCoursesFromDriveFolder = async (folderUrl: string): Promise<DriveCourseInput[]> => {
  const rootId = extractDriveFolderId(folderUrl);
  const rootItems = await listDriveFolder(rootId);
  const courseFolders = sortByName(rootItems.filter(isFolder));
  const rootVideos = sortByName(rootItems.filter(isVideo));

  if (courseFolders.length === 0 && rootVideos.length > 0) {
    return [{
      title: 'Curso importado desde Drive',
      description: 'Contenido importado desde Google Drive.',
      modules: [{
        title: 'Contenido',
        lessons: rootVideos.map((file) => ({
          title: trimVideoExtension(file.name),
          videoUrl: drivePreviewUrl(file.id),
        })),
      }],
    }];
  }

  return Promise.all(courseFolders.map(buildCourseFromDriveFolder));
};

export const importDriveFolder = async ({ folderUrl, instructor, status = COURSE_STATUS.DRAFT }: DriveFolderImportInput): Promise<ImportResult> => {
  const courses = await buildCoursesFromDriveFolder(folderUrl);
  return importDriveCourses({ courses, instructor, status, includeEmptyModules: true });
};

export const importDriveCourses = async ({ courses, instructor, status = COURSE_STATUS.DRAFT, includeEmptyModules = false }: ImportInput): Promise<ImportResult> => {
  const result: ImportResult = {
    createdCourses: 0,
    updatedCourses: 0,
    createdModules: 0,
    createdLessons: 0,
    skippedLessons: 0,
  };

  for (const inputCourse of asArray(courses)) {
    const title = String(inputCourse.title || '').trim();
    if (!title) continue;

    const slug = makeSlug(title);
    const description = inputCourse.description || `Contenido importado desde Google Drive para ${title}.`;
    let course = await Course.findOne({ slug });

    if (!course) {
      course = await Course.create({
        title,
        slug,
        description,
        shortDescription: description,
        price: 0,
        category: 'Academia',
        instructor,
        status,
      });
      result.createdCourses += 1;
    } else {
      course.description = course.description || description;
      course.shortDescription = course.shortDescription || description;
      course.status = status;
      await course.save();
      result.updatedCourses += 1;
    }

    const modules = asArray(inputCourse.modules).filter((module) => includeEmptyModules || asArray(module.lessons).length > 0);
    for (const [moduleIndex, inputModule] of modules.entries()) {
      const moduleTitle = String(inputModule.title || `Modulo ${moduleIndex + 1}`).trim();
      const moduleSlug = makeSlug(moduleTitle);
      let module = await Module.findOne({ courseId: String(course._id), slug: moduleSlug });

      if (!module) {
        module = await Module.create({
          courseId: String(course._id),
          title: moduleTitle,
          slug: moduleSlug,
          description: asArray(inputModule.resources).map((resource) => `${resource.name}: ${resource.url}`).join('\n'),
          order: moduleIndex,
          isPublished: true,
        });
        course.modules = [...(course.modules ?? []), String(module._id)];
        result.createdModules += 1;
      }

      for (const [lessonIndex, inputLesson] of asArray(inputModule.lessons).entries()) {
        const lessonTitle = String(inputLesson.title || `Leccion ${lessonIndex + 1}`).trim();
        if (!lessonTitle) continue;

        const lessonSlug = makeSlug(lessonTitle);
        const exists = await Lesson.findOne({
          course: String(course._id),
          moduleId: String(module._id),
          slug: lessonSlug,
        });

        if (exists) {
          result.skippedLessons += 1;
          continue;
        }

        const lesson = await Lesson.create({
          title: lessonTitle,
          slug: lessonSlug,
          course: String(course._id),
          moduleId: String(module._id),
          order: lessonIndex,
          videoUrl: inputLesson.videoUrl || '',
          resources: asArray(inputLesson.resources),
          content: '',
          duration: 0,
          isPreview: false,
          isFree: false,
        });
        module.lessonIds = [...(module.lessonIds ?? []), String(lesson._id)];
        course.lessons = [...(course.lessons ?? []), String(lesson._id)];
        result.createdLessons += 1;
      }

      await module.save();
    }

    course.totalLessons = (course.lessons ?? []).length;
    await course.save();
  }

  return result;
};
