import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { BULK_PRODUCT_UPLOAD_MAX_SIZE } from './bulk-product-upload';

const csvMimeTypes = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
]);

export const bulkProductUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  fileFilter: (_request, file, callback) => {
    if (
      !file.originalname.toLocaleLowerCase('en').endsWith('.csv') ||
      !csvMimeTypes.has(file.mimetype.toLocaleLowerCase('en'))
    ) {
      callback(
        new BadRequestException('Upload a CSV file with a .csv filename.'),
        false,
      );
      return;
    }

    callback(null, true);
  },
  limits: {
    files: 1,
    fileSize: BULK_PRODUCT_UPLOAD_MAX_SIZE,
  },
};
