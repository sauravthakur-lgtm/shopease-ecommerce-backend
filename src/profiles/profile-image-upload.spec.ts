import { BadRequestException } from '@nestjs/common';
import {
  hasValidImageSignature,
  PROFILE_IMAGE_MAX_SIZE,
  profileImageUploadOptions,
} from './profile-image-upload';

describe('hasValidImageSignature', () => {
  it.each([
    [
      'image/jpeg',
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    ],
    [
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    [
      'image/webp',
      Buffer.from('RIFF0000WEBP', 'ascii'),
    ],
  ])('accepts a matching %s signature', (mimetype, buffer) => {
    expect(hasValidImageSignature({ mimetype, buffer })).toBe(true);
  });

  it('rejects a declared image type whose contents do not match', () => {
    expect(
      hasValidImageSignature({
        mimetype: 'image/png',
        buffer: Buffer.from('not an image'),
      }),
    ).toBe(false);
  });

  it('rejects unsupported image types', () => {
    expect(
      hasValidImageSignature({
        mimetype: 'image/gif',
        buffer: Buffer.from('GIF89a'),
      }),
    ).toBe(false);
  });

  it('enforces a single image with a 5 MiB limit', () => {
    expect(profileImageUploadOptions.limits).toEqual({
      files: 1,
      fileSize: PROFILE_IMAGE_MAX_SIZE,
    });
    expect(PROFILE_IMAGE_MAX_SIZE).toBe(5 * 1024 * 1024);
  });

  it('rejects unsupported declared MIME types at the upload boundary', () => {
    const callback = jest.fn();
    profileImageUploadOptions.fileFilter?.(
      {} as never,
      { mimetype: 'image/gif' } as Express.Multer.File,
      callback,
    );
    expect(callback).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      false,
    );
  });
});
