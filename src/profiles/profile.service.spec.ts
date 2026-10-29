import { BadRequestException, NotFoundException } from '@nestjs/common';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProfileService } from './profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { getProfileImageDirectory } from './profile-image-upload';

describe('ProfileService', () => {
  const profile = {
    id: 'user-1',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    phone: '5550100',
    profileImage: null,
    role: 'VENDOR',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new ProfileService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only selected safe fields for the authenticated role', async () => {
    prisma.user.findFirst.mockResolvedValue(profile);

    await expect(service.getProfile('user-1', 'VENDOR')).resolves.toEqual({
      success: true,
      profile,
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', role: 'VENDOR' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profileImage: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('updates only the explicitly permitted profile fields', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    prisma.user.update.mockResolvedValue(profile);

    await service.updateProfile('user-1', 'ADMIN', {
      name: 'Alex Updated',
      phone: '5551234',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { name: 'Alex Updated', phone: '5551234' },
        select: expect.objectContaining({
          id: true,
          name: true,
          email: true,
          phone: true,
          profileImage: true,
        }),
      }),
    );
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('role');
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('password');
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', role: 'ADMIN' },
      select: { id: true },
    });
  });

  it('rejects profile reads when the authenticated user does not match the role', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getProfile('user-1', 'CUSTOMER')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects updates when the authenticated user does not match the role', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.updateProfile('user-1', 'VENDOR', { name: 'Alex Updated' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each(['CUSTOMER', 'VENDOR', 'ADMIN'] as const)(
    'stores an image under the authenticated %s profile only',
    async (role) => {
      const filename = `${randomUUID()}.png`;
      const filePath = join(getProfileImageDirectory(), filename);
      const imageBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      await mkdir(getProfileImageDirectory(), { recursive: true });
      await writeFile(filePath, imageBytes);
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        profileImage: null,
      });
      prisma.user.update.mockImplementation(async ({ data }) => ({
        ...profile,
        role,
        profileImage: data.profileImage,
      }));

      const file: Express.Multer.File = {
        fieldname: 'image',
        originalname: 'untrusted.png',
        encoding: '7bit',
        mimetype: 'image/png',
        size: imageBytes.length,
        destination: getProfileImageDirectory(),
        filename,
        path: filePath,
        buffer: imageBytes,
      };

      try {
        const result = await service.uploadProfileImage('user-1', role, file);
        expect(prisma.user.findFirst).toHaveBeenCalledWith({
          where: { id: 'user-1', role },
          select: { id: true, profileImage: true },
        });
        expect(result.profile.profileImage).toBe(`/uploads/profiles/${filename}`);
        expect(result.profile.role).toBe(role);
      } finally {
        await unlink(filePath).catch(() => undefined);
      }
    },
  );

  it('removes an image whose contents do not match its declared type', async () => {
    const filename = `${randomUUID()}.png`;
    const filePath = join(getProfileImageDirectory(), filename);
    await mkdir(getProfileImageDirectory(), { recursive: true });
    await writeFile(filePath, Buffer.from('not a PNG image'));

    const file: Express.Multer.File = {
      fieldname: 'image',
      originalname: 'fake.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 15,
      destination: getProfileImageDirectory(),
      filename,
      path: filePath,
      buffer: Buffer.from('not a PNG image'),
    };

    await expect(
      service.uploadProfileImage('user-1', 'CUSTOMER', file),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(access(filePath)).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
