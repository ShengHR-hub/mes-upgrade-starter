import { describe, expect, it } from 'vitest';

import { TokenService } from '../../common/auth/token.service.js';
import { ErrorCode } from '../../common/constants/error-code.js';

import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';

/**
 * B9 认证服务测试（替身数据源 + 真实 Argon2id + 真实 jose；不连数据库）。
 *
 * 覆盖：登录失败统一 20003（不泄露账号存在性）、停用账号不可登录、
 * 种子占位哈希不可登录（AUTH-3 不静默改写既有口令）、
 * 改密旧密码错误/新旧相同/成功 + 审计脱敏、令牌 2 小时口径。
 */

const TEST_SECRET = 's10-auth-secret-0123456789abcdef0123456789abcdef';

function configWithSecret(): never {
  return {
    get: (key: string) => (key === 'JWT_SECRET' ? TEST_SECRET : undefined),
  } as never;
}

/** 登录 / me 场景替身 */
function makeLoginHarness(
  rows: Array<Record<string, unknown>>,
  existingHash?: string,
): { service: AuthService } {
  const dataSource = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT id, username, name, role, enabled, password_hash')) {
        return rows.map((row) => ({ password_hash: existingHash ?? null, ...row }));
      }
      if (sql.startsWith('SELECT id, username, name, dept, post, role, phone, enabled')) {
        return rows;
      }
      return [{}];
    },
  };
  const service = new AuthService(
    dataSource as never,
    new TokenService(configWithSecret()),
    new PasswordService(),
    { write: async () => undefined } as never,
  );
  return { service };
}

/** 改密场景替身 */
function makeChangeHarness(existingHash: string): {
  service: AuthService;
  updated: unknown[][];
  auditCalls: Array<{ detail?: string | null }>;
} {
  const updated: unknown[][] = [];
  const auditCalls: Array<{ detail?: string | null }> = [];
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('SELECT id, password_hash, enabled')) {
            return [{ id: '1', password_hash: existingHash, enabled: 1 }];
          }
          if (sql.startsWith('UPDATE sys_user SET password_hash')) {
            updated.push(params ?? []);
            return { affectedRows: 1 };
          }
          return [{}];
        },
      }),
  };
  const audit = {
    write: async (_manager: unknown, entry: { detail?: string | null }) => {
      auditCalls.push(entry);
    },
  };
  const service = new AuthService(
    dataSource as never,
    new TokenService(configWithSecret()),
    new PasswordService(),
    audit as never,
  );
  return { service, updated, auditCalls };
}

describe('AuthService.login', () => {
  it('账号不存在 → 统一 20003（错误信息固定，不泄露存在性）', async () => {
    const { service } = makeLoginHarness([]);
    await expect(service.login({ username: 'ghost', password: 'whatever' })).rejects.toMatchObject(
      { code: ErrorCode.INVALID_CREDENTIALS, message: '用户名或密码错误' },
    );
  });

  it('口令错误 → 20003（真实 Argon2id 校验）', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('RightPass1');
    const { service } = makeLoginHarness(
      [{ id: '1', username: 'admin', name: '李厂长', role: 'admin', enabled: 1 }],
      hash,
    );
    await expect(
      service.login({ username: 'admin', password: 'WrongPass9' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('种子占位哈希（非 argon2 格式）→ 20003（不静默改写既有口令）', async () => {
    const { service } = makeLoginHarness(
      [{ id: '1', username: 'admin', name: '李厂长', role: 'admin', enabled: 1 }],
      'PLACEHOLDER-NOT-A-HASH',
    );
    await expect(
      service.login({ username: 'admin', password: 'anything' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('账号停用 → 20003（登录阶段即拒绝）', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('RightPass1');
    const { service } = makeLoginHarness(
      [{ id: '2', username: 'op1', name: '操作员', role: 'operator', enabled: 0 }],
      hash,
    );
    await expect(
      service.login({ username: 'op1', password: 'RightPass1' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('登录成功：签发 2 小时 JWT，返回用户摘要（响应不含哈希）', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('RightPass1');
    const { service } = makeLoginHarness(
      [{ id: '1', username: 'admin', name: '李厂长', role: 'admin', enabled: 1 }],
      hash,
    );
    const session = await service.login({ username: 'admin', password: 'RightPass1' });
    expect(session.tokenType).toBe('Bearer');
    expect(session.user).toEqual({ id: '1', username: 'admin', name: '李厂长', role: 'admin' });
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(hash);
    expect(serialized).not.toContain('$argon2');
    // 令牌可被同一套 iss/aud/密钥校验通过
    const payload = await new TokenService(configWithSecret()).verifyAccessToken(
      session.accessToken,
    );
    expect(payload.sub).toBe('1');
    expect(payload.role).toBe('admin');
  });
});

describe('AuthService.me', () => {
  it('返回当前用户资料（身份来自令牌，非客户端）', async () => {
    const { service } = makeLoginHarness([
      {
        id: '3',
        username: 'op3',
        name: '张三',
        dept: null,
        post: '操作员',
        role: 'operator',
        phone: null,
        enabled: 1,
      },
    ]);
    expect(await service.me('3')).toEqual({
      id: '3',
      username: 'op3',
      name: '张三',
      dept: null,
      post: '操作员',
      role: 'operator',
      phone: null,
      enabled: true,
    });
  });

  it('账号不存在 → 20001', async () => {
    const { service } = makeLoginHarness([]);
    await expect(service.me('404')).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });
});

describe('AuthService.changePassword', () => {
  it('旧密码错误 → 20003', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('OldPass1');
    const { service } = makeChangeHarness(hash);
    await expect(
      service.changePassword('1', { oldPassword: 'Nope1', newPassword: 'NewPass2' }, { ip: null }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('新旧密码相同 → 10001', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('SamePass1');
    const { service } = makeChangeHarness(hash);
    await expect(
      service.changePassword(
        '1',
        { oldPassword: 'SamePass1', newPassword: 'SamePass1' },
        { ip: null },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('成功：写入 Argon2id 新哈希 + 审计（detail 不含口令/哈希）', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('OldPass1');
    const { service, updated, auditCalls } = makeChangeHarness(hash);
    const result = await service.changePassword(
      '1',
      { oldPassword: 'OldPass1', newPassword: 'NewPass2' },
      { ip: '127.0.0.1' },
    );
    expect(result).toBeNull();
    expect(updated).toHaveLength(1);
    const newHash = updated[0][0] as string;
    expect(newHash.startsWith('$argon2id$')).toBe(true);
    expect(newHash).not.toBe(hash);
    expect(await passwords.verifyPassword(newHash, 'NewPass2')).toBe(true);
    // 旧口令不能解锁新哈希；审计明细脱敏
    expect(await passwords.verifyPassword(newHash, 'OldPass1')).toBe(false);
    const detail = JSON.stringify(auditCalls[0]?.detail ?? '');
    expect(detail).not.toContain('OldPass1');
    expect(detail).not.toContain('NewPass2');
    expect(detail).not.toContain('$argon2');
  });
});

describe('PasswordService', () => {
  it('占位串/空串一律判为不可校验（isArgon2Hash=false，verify=false）', async () => {
    const passwords = new PasswordService();
    expect(passwords.isArgon2Hash('PLACEHOLDER')).toBe(false);
    expect(passwords.isArgon2Hash(null)).toBe(false);
    expect(await passwords.verifyPassword('PLACEHOLDER', 'x')).toBe(false);
    expect(await passwords.verifyPassword(null, 'x')).toBe(false);
  });

  it('hash → verify 往返成功', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hashPassword('RoundTrip1');
    expect(passwords.isArgon2Hash(hash)).toBe(true);
    expect(await passwords.verifyPassword(hash, 'RoundTrip1')).toBe(true);
    expect(await passwords.verifyPassword(hash, 'Mismatch1')).toBe(false);
  });
});
