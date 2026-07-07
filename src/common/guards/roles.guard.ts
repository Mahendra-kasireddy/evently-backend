import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Enforces @Roles(...) metadata. Runs after authentication, so request.user
 * is expected to be present. Routes without @Roles are allowed through.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    const hasRole = !!user && user.roles?.some((r) => required.includes(r as Role));

    if (!hasRole) {
      throw new ForbiddenException('Insufficient role for this resource');
    }
    return true;
  }
}
