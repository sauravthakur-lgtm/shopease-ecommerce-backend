import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy active accounts', () => {
  const payload = {
    sub: 'user-1',
    email: 'vendor@example.com',
    role: UserRole.VENDOR,
  };
  const createStrategy = (user: object | null) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    } as unknown as PrismaService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;
    return {
      prisma,
      strategy: new JwtStrategy(config, prisma),
    };
  };

  it('rejects a token after its account is deactivated', async () => {
    const { strategy } = createStrategy({
      id: 'user-1',
      email: 'vendor@example.com',
      role: UserRole.VENDOR,
      isActive: false,
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns the current active account identity', async () => {
    const { strategy, prisma } = createStrategy({
      id: 'user-1',
      email: 'current@example.com',
      role: UserRole.VENDOR,
      isActive: true,
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'current@example.com',
      role: UserRole.VENDOR,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });
});
