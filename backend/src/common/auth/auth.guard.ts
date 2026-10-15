import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';

import { ErrorCode } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';

import { IDENTITY_RESOLVER, type IdentityResolver } from './identity-resolver.js';
import type { AuthenticatedRequest } from './identity.types.js';

/**
 * 认证守卫（fail-closed）—— 契约 §5.1 / §5.2。
 *
 * 行为：
 * 1. 调用 `IdentityResolver` 解析服务端可信身份；
 * 2. 解析不到（未携带令牌，或未配置 JWT_SECRET 时的默认占位实现）→
 *    `20001 UNAUTHENTICATED`，请求被拒绝；
 * 3. 令牌无效/过期/账号停用等由解析器按契约错误码直接抛出（20001/20002/20004）；
 * 4. 解析到身份 → 写入 `request.user`，交给 `RolesGuard` 做角色判定。
 *
 * 解析器在 S10（B9）起默认绑定 `JwtIdentityResolver`（配置了 JWT_SECRET 时）：
 * 严格校验签名、算法、sub/iat/exp/iss/aud，并每请求核对当前 sys_user.enabled/role。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(IDENTITY_RESOLVER) private readonly resolver: IdentityResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.resolver.resolve(request as never);

    if (!user || !user.id) {
      throw new BusinessException(
        ErrorCode.UNAUTHENTICATED,
        '未认证：缺少有效的访问令牌（Authorization: Bearer <token>）。',
      );
    }

    request.user = user;
    return true;
  }
}
