import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { readFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  getProfileImageDirectory,
  hasValidImageSignature,
  PROFILE_IMAGE_TYPES,
} from './profile-image-upload';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  profileImage: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string, role: UserRole) {
    const profile = await this.prisma.user.findFirst({
      where: { id: userId, role },
      select: profileSelect,
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return { success: true, profile };
  }

  async updateProfile(userId: string, role: UserRole, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id: userId, role },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Profile not found');
    }

    const profile = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.profileImage !== undefined && {
          profileImage: dto.profileImage,
        }),
      },
      select: profileSelect,
    });

    return {
      success: true,
      message: 'Profile updated successfully',
      profile,
    };
  }

  async uploadProfileImage(
    userId: string,
    role: UserRole,
    file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Profile image file is required');
    }

    const filename = basename(file.filename);
    const filePath = join(getProfileImageDirectory(), filename);
    let existing: { id: string; profileImage: string | null };
    try {
      const buffer = await readFile(filePath);
      if (!hasValidImageSignature({ mimetype: file.mimetype, buffer })) {
        throw new BadRequestException(
          'File contents do not match a supported image format',
        );
      }

      const profile = await this.prisma.user.findFirst({
        where: { id: userId, role },
        select: { id: true, profileImage: true },
      });
      if (!profile) {
        throw new NotFoundException('Profile not found');
      }
      existing = profile;
    } catch (error) {
      await this.removeUploadedImage(filePath);
      throw error;
    }

    const profileImage = `/uploads/profiles/${filename}`;
    let updatedProfile;
    try {
      updatedProfile = await this.prisma.user.update({
        where: { id: userId },
        data: { profileImage },
        select: profileSelect,
      });
    } catch (error) {
      await this.removeUploadedImage(filePath);
      throw error;
    }

    await this.removeStoredProfileImage(existing.profileImage);
    return {
      success: true,
      message: 'Profile image updated successfully',
      profile: updatedProfile,
    };
  }

  private async removeUploadedImage(filePath: string) {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not remove rejected profile upload: ${filePath}`);
      }
    }
  }

  private async removeStoredProfileImage(imagePath: string | null) {
    if (!imagePath?.startsWith('/uploads/profiles/')) return;
    const filename = basename(imagePath);
    if (!filename || filename !== imagePath.slice('/uploads/profiles/'.length)) {
      return;
    }
    try {
      await unlink(join(getProfileImageDirectory(), filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not remove previous profile image: ${filename}`);
      }
    }
  }
}
