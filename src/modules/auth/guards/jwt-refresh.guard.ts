import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards the refresh endpoint with the 'jwt-refresh' strategy. */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
