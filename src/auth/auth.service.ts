import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { vendorPendingApprovalNotification } from '../notifications/notification-events';
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Register
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            name: dto.name.trim(),
            email,
            password: hashedPassword,
            role: dto.role,
            isActive: dto.role === 'CUSTOMER',
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        });

        // New vendors start inactive and need an administrator's approval.
        if (createdUser.role === 'VENDOR') {
          await this.notificationsService.notifyAdmins(
            tx,
            vendorPendingApprovalNotification(createdUser),
          );
        }

        return createdUser;
      });

      // Send welcome email only to customers
      if (user.role === 'CUSTOMER') {
        try {
          await this.mailService.sendEmail(
            user.email,
            'Welcome to Our E-commerce Store!',
            `Hi ${user.name},\n\nYour registration was successful. Welcome to our e-commerce store!\n\nThank you for joining us.`,
          );
        } catch (error) {
          // Email failure should not undo successful registration
          console.error('Welcome email could not be sent.');
        }
      }

      return {
        success: true,
        message: 'Registration successful',
        user,
      };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  // Login
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Your account is inactive');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      success: true,
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
  // Forgot Password
async forgotPassword(email: string) {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await this.prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Don't reveal whether an email is registered
  if (!user) {
    return {
      success: true,
      message: 'If the account exists, reset instructions will be sent.',
    };
  }

  const rawToken = randomBytes(32).toString('hex');
  const hashedToken = createHash('sha256')
    .update(rawToken)
    .digest('hex');

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
    },
  });         

  const resetLink =
    `http://localhost:8080/apis/auth/reset-password?token=${rawToken}`;

  try {
    await this.mailService.sendEmail(
      user.email,
      'Reset Your Password',
      `Hi ${user.name},\n\nUse this link to reset your password within 15 minutes:\n${resetLink}\n\nIf you did not request this, ignore this email.`,
    );
  } catch (error) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    console.error('Password reset email could not be sent.');
  }

  return {
    success: true,
    message: 'If the account exists, reset instructions will be sent.',
  };
}
// Reset Password
async resetPassword(dto: ResetPasswordDto) {
  const hashedToken = createHash('sha256')
    .update(dto.token)
    .digest('hex');

  const user = await this.prisma.user.findFirst({
    where: {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new BadRequestException(
      'Invalid or expired password reset token',
    );
  }

  const hashedPassword = await bcrypt.hash(dto.password, 10);

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    },
  });

  return {
    success: true,
    message: 'Password reset successfully. You can now log in.',
  };
}
} 