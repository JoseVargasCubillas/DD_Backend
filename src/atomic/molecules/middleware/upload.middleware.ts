import multer from 'multer';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => { cb(null, ALLOWED_TYPES.includes(file.mimetype)); },
  limits: { fileSize: 100 * 1024 * 1024 },
});
