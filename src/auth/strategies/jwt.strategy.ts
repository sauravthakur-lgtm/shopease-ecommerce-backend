
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type {
  AuthenticatedUser,
  UserRole,
} from '../interfaces/authenticated-user.interface';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

const userRoles: UserRole[] = ['ADMIN', 'VENDOR', 'CUSTOMER'];

function isJwtPayload(payload: unknown): payload is JwtPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  const claims = payload as Record<string, unknown>;
  return (
    typeof claims.sub === 'string' &&
    claims.sub.length > 0 &&
    typeof claims.email === 'string' &&
    claims.email.length > 0 &&
    typeof claims.role === 'string' &&
    userRoles.includes(claims.role as UserRole)
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.getOrThrow<string>('JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive || user.role !== payload.role) {
      throw new UnauthorizedException('Your account is inactive or no longer available.');
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }
}