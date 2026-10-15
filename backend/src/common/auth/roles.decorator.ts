import { SetMetadata } from '@nestjs/common';

import type { Role } from './identity.types.js';

/** 权限元数据键 */
export const REQUIRED_ROLES = 'mes:required-roles';

/**
 * 声明访问该路由所需的角色（契约 §5.2）。
 *
 * 用法：`@RequireRoles('admin', 'manager')`；不声明时表示「仅需登录」。
 * 真正的判定在 `RolesGuard`，前端隐藏按钮**不能**替代本处鉴权。
 */
export const RequireRoles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);
