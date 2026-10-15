import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { TokenService } from '../../common/auth/token.service.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { isRole, type Role } from '../../common/auth/identity.types.js';
import { AuditService } from '../audit/audit.service.js';

import { PasswordService } from './password.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { ChangePasswordDto } from './dto/login.dto.js';
import type { CurrentUserResponse, SessionResponse } from './dto/user-response.js';

interface UserCredentialRow {
  id: string;
  username: string;
  name: string;
  role: string;
  enabled: number;
  password_hash: string | null;
}

/**
 * 认证服务 —— 契约 §5.1 / §5.3（登录、当前用户、改密）。
 *
 * Q4 批准口径（S5 交接 §13.3）：
 * - Q4-1：HS256、2 小时、iss/aud 固定、JWT_SECRET ≥32 字节；
 * - Q4-2：无 refresh token；退出不立即撤销；即时失效靠每请求读 sys_user.enabled；
 * - Q4-3：**不实现首登强制改密**；密码强度策略未批准，只做结构性约束；
 *   改密后旧令牌在有效期内仍可用（不宣称即时吊销）。
 *
 * 安全边界：
 * - 登录失败统一 20003（不泄露账号存在性），账号不存在时也执行一次 Argon2
 *   校验以抹平时序差异；
 * - `password_hash` 只在登录/改密路径按需读取，绝不进日志/响应/异常；
 * - 种子 `password_hash` 是占位串 → 按口令不匹配处理（AUTH-3：账号重置另行授权）。
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  /** POST /api/v1/sessions —— 登录（公共接口，无守卫） */
  async login(dto: LoginDto): Promise<SessionResponse> {
    const rows = (await this.dataSource.query(
      'SELECT id, username, name, role, enabled, password_hash FROM sys_user WHERE username = ?',
      [dto.username],
    )) as UserCredentialRow[];
    const user = rows[0];

    // 账号不存在 / 已停用：仍做一次哈希校验抹平时序，再统一 20003
    if (!user || Number(user.enabled) !== 1) {
      await this.passwords.verifyPassword(PLACEHOLDER_HASH_FOR_TIMING, dto.password);
      throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误');
    }

    const ok = await this.passwords.verifyPassword(user.password_hash, dto.password);
    if (!ok) {
      throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    if (!isRole(user.role)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '账号角色无效，请联系管理员');
    }

    const { token, expiresAt } = await this.tokens.signAccessToken({
      sub: String(user.id),
      role: user.role,
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresAt: toShanghaiRfc3339(expiresAt),
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        role: user.role as Role,
      },
    };
  }

  /** GET /api/v1/users/me —— 当前用户资料（身份来自令牌，非客户端） */
  async me(userId: string): Promise<CurrentUserResponse> {
    const rows = (await this.dataSource.query(
      [
        'SELECT id, username, name, dept, post, role, phone, enabled',
        'FROM sys_user WHERE id = ?',
      ].join(' '),
      [userId],
    )) as Array<{
      id: string;
      username: string;
      name: string;
      dept: string | null;
      post: string | null;
      role: string;
      phone: string | null;
      enabled: number;
    }>;
    const user = rows[0];
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, '未认证：账号不存在或已删除');
    }
    if (Number(user.enabled) !== 1) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '账号已停用，请联系管理员');
    }
    if (!isRole(user.role)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '账号角色无效，请联系管理员');
    }

    return {
      id: String(user.id),
      username: user.username,
      name: user.name,
      dept: user.dept,
      post: user.post,
      role: user.role as Role,
      phone: user.phone,
      enabled: true,
    };
  }

  /**
   * POST /api/v1/users/me/password-changes —— 修改自身密码。
   *
   * - 校验旧密码（不符 → 20003）；
   * - 新密码只做结构性约束（非空、≤64、不得与旧密码相同）—— 强度策略待 Q4-3 批准；
   * - 与审计同一事务；审计 detail **不含任何口令或哈希**；
   * - 旧令牌在 2 小时有效期内仍可用（Q4-2 口径，不宣称即时吊销）。
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context: { ip: string | null },
  ): Promise<null> {
    if (dto.newPassword === dto.oldPassword) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'newPassword', reason: '新密码不能与旧密码相同' }],
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        'SELECT id, password_hash, enabled FROM sys_user WHERE id = ? FOR UPDATE',
        [userId],
      )) as Array<{ id: string; password_hash: string | null; enabled: number }>;
      const user = rows[0];
      if (!user) {
        throw new BusinessException(ErrorCode.UNAUTHENTICATED, '未认证：账号不存在或已删除');
      }
      if (Number(user.enabled) !== 1) {
        throw new BusinessException(ErrorCode.FORBIDDEN, '账号已停用，请联系管理员');
      }

      const ok = await this.passwords.verifyPassword(user.password_hash, dto.oldPassword);
      if (!ok) {
        throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, '旧密码不正确');
      }

      // 新密码不得与旧密码相同（用现有哈希校验，避免提前知道明文）
      const same = await this.passwords.verifyPassword(user.password_hash, dto.newPassword);
      if (same) {
        throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
          errors: [{ field: 'newPassword', reason: '新密码不能与旧密码相同' }],
        });
      }

      const newHash = await this.passwords.hashPassword(dto.newPassword);
      await manager.query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [
        newHash,
        userId,
      ]);

      await this.audit.write(manager, {
        userId,
        action: '修改密码',
        target: `sys_user:${userId}`,
        detail: '用户自行修改登录密码',
        ip: context.ip,
      });

      return null;
    });
  }
}

/**
 * 时序抹平用的占位 Argon2id 哈希 —— 只是对一个随机无用字符串的哈希，
 * **不是任何账号的凭据**，仅用于「账号不存在」路径执行一次等价的校验开销。
 * 不构成密钥，可安全留在源码中。
 */
const PLACEHOLDER_HASH_FOR_TIMING =
  '$argon2id$v=19$m=19456,t=2,p=1$42eIeLOClznUv3M0fx4Yxw$3WNvE1ddb1B9Aapde3zeGVKd4tRU2tP8QkOZbq1ONEA';
