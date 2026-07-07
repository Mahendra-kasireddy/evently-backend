import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  email?: string;
  phone?: string;
  roles: string[];
}

/**
 * Injects the authenticated user (set by JwtStrategy) into a handler param.
 * Usage: `@CurrentUser() user: AuthUser` or `@CurrentUser('userId') id: string`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
