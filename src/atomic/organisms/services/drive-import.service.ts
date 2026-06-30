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
  resetExisting?: boolean;
}

interface ImportResult {
  createdCourses: number;
  updatedCourses: number;
  resetCourses: number;
  createdModules: number;
  createdLessons: number;
  skippedLessons: number;
}

interface DrivePreviewCourse {
  title: string;
  modules: number;
  lessons: number;
}

interface DrivePreviewResult {
  rootFolders: number;
  rootVideos: number;
  courses: DrivePreviewCourse[];
}

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
}

interface DriveListResponse {
  files?: DriveApiFile[];
  error?: { message?: string };
}

interface DriveFolderImportInput {
  folderUrl: string;
  instructor: string;
  status?: string;
  resetExisting?: boolean;
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

const isFolder = (file: DriveApiFile): boolean =>
  file.mimeType === 'application/vnd.google-apps.folder' ||
  (
    file.mimeType === 'application/vnd.google-apps.shortcut' &&
    file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder'
  );

const driveFolderId = (file: DriveApiFile): string =>
  file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder' && file.shortcutDetails.targetId
    ? file.shortcutDetails.targetId
    : file.id;

const uniqueFolders = (files: DriveApiFile[]): DriveApiFile[] => {
  const seen = new Set<string>();
  return files.filter((file) => {
    const id = driveFolderId(file);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const isVideo = (file: DriveApiFile): boolean =>
  file.mimeType.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);

const listDriveFolder = async (folderId: string): Promise<DriveApiFile[]> => {
  if (!env.googleDrive.apiKey) {
    throw Object.assign(new Error('Falta GOOGLE_DRIVE_API_KEY en el backend'), { statusCode: 500 });
  }

  const params = new URLSearchParams({
    key: env.googleDrive.apiKey,
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,shortcutDetails(targetId,targetMimeType))',
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
    sortByName(uniqueFolders(items.filter(isFolder))).map(async (folder) => collectVideosDeep(driveFolderId(folder), depth + 1)),
  );

  return [...directVideos, ...nested.flat()];
};

const buildCourseFromDriveFolder = async (folder: DriveApiFile): Promise<DriveCourseInput> => {
  const items = await listDriveFolder(driveFolderId(folder));
  const directVideos = sortByName(items.filter(isVideo));
  const childFolders = sortByName(uniqueFolders(items.filter(isFolder)));
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
      lessons: await collectVideosDeep(driveFolderId(childFolder)),
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
  const courseFolders = sortByName(uniqueFolders(rootItems.filter(isFolder)));
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

export const previewDriveFolder = async (folderUrl: string): Promise<DrivePreviewResult> => {
  const rootId = extractDriveFolderId(folderUrl);
  const rootItems = await listDriveFolder(rootId);
  const rootFolders = sortByName(uniqueFolders(rootItems.filter(isFolder)));
  const rootVideos = sortByName(rootItems.filter(isVideo));
  const courses = await buildCoursesFromDriveFolder(folderUrl);

  return {
    rootFolders: rootFolders.length,
    rootVideos: rootVideos.length,
    courses: courses.map((course) => ({
      title: course.title,
      modules: asArray(course.modules).length,
      lessons: asArray(course.modules).reduce((sum, module) => sum + asArray(module.lessons).length, 0),
    })),
  };
};

const resetCourseContent = async (courseId: string): Promise<void> => {
  const [modules, lessons] = await Promise.all([
    Module.find({ courseId }),
    Lesson.find({ course: courseId }),
  ]);

  await Promise.all([
    ...modules.map((module) => Module.findByIdAndDelete(module._id)),
    ...lessons.map((lesson) => Lesson.findByIdAndDelete(lesson._id)),
  ]);
};

export const importDriveFolder = async ({ folderUrl, instructor, status = COURSE_STATUS.DRAFT, resetExisting = false }: DriveFolderImportInput): Promise<ImportResult> => {
  const courses = await buildCoursesFromDriveFolder(folderUrl);
  return importDriveCourses({ courses, instructor, status, includeEmptyModules: false, resetExisting });
};

export const importDriveCourses = async ({ courses, instructor, status = COURSE_STATUS.DRAFT, includeEmptyModules = false, resetExisting = false }: ImportInput): Promise<ImportResult> => {
  const result: ImportResult = {
    createdCourses: 0,
    updatedCourses: 0,
    resetCourses: 0,
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
      if (resetExisting) {
        await resetCourseContent(String(course._id));
        course.modules = [];
        course.lessons = [];
        course.totalLessons = 0;
        result.resetCourses += 1;
      }
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
