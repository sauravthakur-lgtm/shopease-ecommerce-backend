import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const PRODUCT_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

export const PRODUCT_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function getProductImageDirectory() {
  return join(process.cwd(), 'uploads', 'products');
}

export const productImageUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      const directory = getProductImageDirectory();
      mkdirSync(directory, { recursive: true });
      callback(null, directory);
    },
    filename: (_request, file, callback) => {
      const extension = PRODUCT_IMAGE_EXTENSIONS[file.mimetype];
      callback(null, `${randomUUID()}.${extension}`);
    },
  }),
  fileFilter: (_request, file, callback) => {
    if (!PRODUCT_IMAGE_EXTENSIONS[file.mimetype]) {
      callback(
        new BadRequestException(
          'Unsupported image type. Upload a JPEG, PNG, WebP, or GIF image.',
        ),
        false,
      );
      return;
    }

    callback(null, true);
  },
  limits: {
    files: 1,
    fileSize: PRODUCT_IMAGE_MAX_SIZE,
  },
};
