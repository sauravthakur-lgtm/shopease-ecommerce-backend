
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type {
  AuthenticatedUser,
  UserRole,
} from '../interfaces/authenticated-user.interface';

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
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: unknown): AuthenticatedUser {
    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}