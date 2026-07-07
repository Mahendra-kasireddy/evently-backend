import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

export interface AccessTokenPayload {
  sub: string;
  email?: string;
  phone?: string;
  roles: string[];
}

/** Validates the access token from the Authorization: Bearer header. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret') as string,
    });
  }

  // Whatever is returned here becomes request.user.
  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    return {
      userId: payload.sub,
      email: payload.email,
      phone: payload.phone,
      roles: payload.roles,
    };
  }
}
