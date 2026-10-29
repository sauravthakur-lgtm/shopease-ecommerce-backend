import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { diskStorage } from 'multer';
import { join } from 'node:path';

export const PROFILE_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
export const PROFILE_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function getProfileImageDirectory() {
  return join(process.cwd(), 'uploads', 'profiles');
}

export const profileImageUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      const directory = getProfileImageDirectory();
      mkdirSync(directory, { recursive: true });
      callback(null, directory);
    },
    filename: (_request, file, callback) => {
      const extension = PROFILE_IMAGE_TYPES[file.mimetype];
      callback(null, `${randomUUID()}.${extension ?? 'bin'}`);
    },
  }),
  fileFilter: (_request, file, callback) => {
    if (!PROFILE_IMAGE_TYPES[file.mimetype]) {
      callback(
        new BadRequestException(
          'Unsupported image type. Upload a JPEG, PNG, or WebP image.',
        ),
        false,
      );
      return;
    }

    callback(null, true);
  },
  limits: {
    files: 1,
    fileSize: PROFILE_IMAGE_MAX_SIZE,
  },
};

export function hasValidImageSignature(
  file: Pick<Express.Multer.File, 'mimetype' | 'buffer'>,
) {
  const { mimetype, buffer } = file;
  if (mimetype === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (mimetype === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}
