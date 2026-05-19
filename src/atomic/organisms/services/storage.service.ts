import { cloudinary } from '../../../config/cloudinary.js';

interface UploadResult { url: string; publicId: string; duration?: number }

export const uploadImage = (buffer: Buffer, folder = 'dd-platform'): Promise<UploadResult> =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err || !result) return reject(err);
      resolve({ url: result.secure_url, publicId: result.public_id });
    }).end(buffer);
  });

export const uploadVideo = (buffer: Buffer, folder = 'dd-platform/videos'): Promise<UploadResult> =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder, resource_type: 'video', chunk_size: 6_000_000 }, (err, result) => {
      if (err || !result) return reject(err);
      resolve({ url: result.secure_url, publicId: result.public_id, duration: (result as any).duration });
    }).end(buffer);
  });

export const deleteFile = (publicId: string, resourceType: 'image' | 'video' = 'image') =>
  cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
