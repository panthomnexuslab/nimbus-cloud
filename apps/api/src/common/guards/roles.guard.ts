import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AccessTokenPayload } from '../types/auth.types';

/**
 * RBAC gate. Routes decorated with `@Roles('ADMIN')` (etc.) reject any
 * caller whose JWT does not list at least one of the required roles.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<{ user?: AccessTokenPayload }>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Insufficient privileges',
      });
    }
    return true;
  }
}
