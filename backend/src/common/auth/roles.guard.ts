import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ErrorCode } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';

import { REQUIRED_ROLES } from './roles.decorator.js';
import type { AuthenticatedRequest, Role } from './identity.types.js';

/**
 * 角色守卫 —— 契约 §5.2 权限矩阵。
 *
 * - 未声明 `@RequireRoles(...)` → 仅要求已登录（由 `AuthGuard` 保证）；
 * - 已声明 → 当前身份角色必须在允许集合内，否则 `20004 FORBIDDEN`（HTTP 403）。
 *
 * 注意：403 与 401 语义严格区分——403 不触发前端重新登录流程。
 * 前端菜单隐藏与按钮显隐只用于界面引导，**不能替代**本守卫。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !user.id) {
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, '未认证：缺少可信身份。');
    }

    if (!required.includes(user.role)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `无权限操作：该接口仅允许 ${required.join(' / ')} 角色访问。`,
      );
    }

    return true;
  }
}
