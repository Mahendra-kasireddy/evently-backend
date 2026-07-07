import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

export interface RefreshTokenPayload {
  sub: string;
}

export interface RefreshRequestUser {
  userId: string;
  refreshToken: string;
}

/**
 * Validates the refresh token (also a Bearer token, signed with the refresh secret)
 * and forwards the raw token so AuthService can compare it against the stored hash.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret') as string,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: RefreshTokenPayload): Promise<RefreshRequestUser> {
    const header = req.get('authorization') ?? '';
    const refreshToken = header.replace('Bearer', '').trim();
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token malformed');
    }
    return { userId: payload.sub, refreshToken };
  }
}
