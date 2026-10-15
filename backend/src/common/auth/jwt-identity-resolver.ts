import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ErrorCode } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { isValidDecimalId } from '../utils/id.util.js';

import type { TokenService } from './token.service.js';
import { isRole, type AuthenticatedUser, type Role } from './identity.types.js';

/**
 * JWT 身份解析器 —— 契约 §5.1 / S5 交接 §13.3 Q4-1/Q4-2。
 *
 * 每次请求：
 * 1. 从 `Authorization: Bearer <token>` 取令牌（**不接受请求体、自定义身份头、
 *    固定账号或前端预览角色作为身份**）；
 * 2. 严格校验签名、算法（仅 HS256）、sub/iat/exp/iss/aud 声明；
 * 3. **重新读取当前 `sys_user` 记录**核对 enabled/role —— 停用账号、角色变化
 *    不能继续沿用旧 JWT 的权限（Q4-2 即时失效口径）；
 * 4. 返回服务端可信身份；无法建立可信身份时按契约错误码拒绝，绝不降级。
 *
 * 错误映射（契约 §3）：
 * - 没有令牌 / 格式不符 → null（由 AuthGuard 统一转 20001）；
 * - 签名错误、声明非法、用户不存在 → 20001；
 * - 令牌过期 → 20002；
 * - 账号已停用 → 20004（403）。
 */
@Injectable()
export class JwtIdentityResolver {
  constructor(
    private readonly tokens: TokenService,
    private readonly dataSource: DataSource,
  ) {}

  async resolve(request: { headers?: Record<string, unknown> }): Promise<AuthenticatedUser | null> {
    const authorization = request.headers?.authorization;
    if (typeof authorization !== 'string' || !/^Bearer\s+\S+/i.test(authorization)) {
      // 未携带令牌：交给守卫按 20001 处理
      return null;
    }
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (token.length === 0) return null;

    let payload: Awaited<ReturnType<TokenService['verifyAccessToken']>>;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ERR_JWT_EXPIRED') {
        throw new BusinessException(ErrorCode.TOKEN_EXPIRED, '登录已过期，请重新登录');
      }
      // 签名错误 / 算法不符 / iss/aud/sub 非法等，统一 20001（不泄露细节）
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, '未认证：访问令牌无效');
    }

    const sub = payload.sub;
    if (typeof sub !== 'string' || !isValidDecimalId(sub)) {
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, '未认证：访问令牌无效');
    }

    // 每次认证都读当前库记录：停用 / 角色变化即时生效
    const rows = (await this.dataSource.query(
      'SELECT id, username, name, role, enabled FROM sys_user WHERE id = ?',
      [sub],
    )) as Array<{ id: string; username: string; name: string; role: string; enabled: number }>;
    const user = rows[0];
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, '未认证：访问令牌无效');
    }
    if (Number(user.enabled) !== 1) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '账号已停用，请联系管理员');
    }
    if (!isRole(user.role)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '账号角色无效，请联系管理员');
    }

    return {
      id: String(user.id),
      role: user.role as Role,
      username: user.username,
      name: user.name,
    };
  }
}
