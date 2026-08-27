import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates when a token is present, and lets the request through when it
 * is not.
 *
 * Used by endpoints that must serve both a signed-in customer and a guest —
 * Contact Us is the first. Pair it with @Public() so the global JwtAuthGuard
 * steps aside first, then this one attaches `request.user` if the caller
 * happens to be signed in.
 *
 * The important half is `handleRequest`: passport's default throws on a
 * missing or invalid token, which is exactly what must not happen here. A bad
 * token is treated as no token — the request continues as a guest rather than
 * failing, so an expired session can never block someone from reaching
 * support.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // No credentials, or credentials we could not verify. Continue as guest.
    }
    return true;
  }

  handleRequest<TUser>(_err: unknown, user: TUser): TUser | undefined {
    return user || undefined;
  }
}
