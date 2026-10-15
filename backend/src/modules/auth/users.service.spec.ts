import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { UsersService } from './users.service.js';

/**
 * B9 用户管理服务测试（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九.8：最后一个启用 admin 的并发保护（FOR UPDATE 串行化语义）、
 * §九.9：日志/响应脱敏（响应不含 password_hash）、用户名唯一冲突。
 */

const ADMIN_ROW = {
  id: '1',
  username: 'admin',
  name: '李厂长',
  dept: null,
  post: null,
  role: 'admin',
  phone: null,
  enabled: 1,
};

const CONTEXT = { userId: '1', ip: '127.0.0.1' };

function makeHarness(options: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): { service: UsersService; audit: { write: ReturnType<typeof vi.fn> } } {
  const audit = { write: vi.fn(async () => undefined) };
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({
        query: async (sql: string, params?: unknown[]) => options.query(sql, params),
      }),
    query: async (sql: string, params?: unknown[]) => options.query(sql, params),
  };
  // PasswordService 由替身哈希路径替换：直接注入真实服务太重，这里 stub 两个方法
  const passwords = {
    hashPassword: async () => '$argon2id$fake-for-test',
  };
  return { service: new UsersService(dataSource as never, passwords as never, audit as never), audit };
}

describe('UsersService.update —— 最后一个启用 admin 保护', () => {
  it('停用最后一个启用 admin → 30002（即使 enabled=false 是显式请求）', async () => {
    const { service, audit } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user u WHERE u.id = ? FOR UPDATE')) return [{ ...ADMIN_ROW }];
        if (sql.includes("WHERE role = 'admin' AND enabled = 1 AND id <> ? FOR UPDATE")) return [];
        return [];
      },
    });
    await expect(service.update('1', { enabled: false }, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('降级最后一个启用 admin → 30002', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user u WHERE u.id = ? FOR UPDATE')) return [{ ...ADMIN_ROW }];
        if (sql.includes("WHERE role = 'admin' AND enabled = 1 AND id <> ? FOR UPDATE")) return [];
        return [];
      },
    });
    await expect(service.update('1', { role: 'manager' }, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('同时停用并降级（双字段）最后一个 admin → 30002', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user u WHERE u.id = ? FOR UPDATE')) return [{ ...ADMIN_ROW }];
        if (sql.includes("WHERE role = 'admin' AND enabled = 1 AND id <> ? FOR UPDATE")) return [];
        return [];
      },
    });
    await expect(
      service.update('1', { role: 'operator', enabled: false }, CONTEXT),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_CONFLICT });
  });

  it('存在其他启用 admin 时允许停用（保护判据只针对“最后一个”）', async () => {
    const { service, audit } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user u WHERE u.id = ? FOR UPDATE')) return [{ ...ADMIN_ROW }];
        if (sql.includes("WHERE role = 'admin' AND enabled = 1 AND id <> ? FOR UPDATE")) {
          return [{ id: '2' }];
        }
        if (sql.startsWith('UPDATE sys_user SET')) return { affectedRows: 1 };
        if (sql.includes('FROM sys_user u WHERE u.id = ?')) {
          return [{ ...ADMIN_ROW, enabled: 0 }];
        }
        return [];
      },
    });
    const result = await service.update('1', { enabled: false }, CONTEXT);
    expect(result.enabled).toBe(false);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });

  it('非 admin 目标（已是 operator）停用不受最后 admin 保护约束', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user u WHERE u.id = ? FOR UPDATE')) {
          return [{ ...ADMIN_ROW, id: '9', role: 'operator', username: 'op9' }];
        }
        if (sql.startsWith('UPDATE sys_user SET')) return { affectedRows: 1 };
        if (sql.includes('FROM sys_user u WHERE u.id = ?')) {
          return [{ ...ADMIN_ROW, id: '9', role: 'operator', username: 'op9', enabled: 0 }];
        }
        return [];
      },
    });
    const result = await service.update('9', { enabled: false }, CONTEXT);
    expect(result.enabled).toBe(false);
  });

  it('目标用户不存在 → 30001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(service.update('404', { name: 'x' }, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });

  it('空 body → 10001', async () => {
    const { service } = makeHarness({
      query: async (sql) =>
        sql.includes('FROM sys_user u WHERE u.id = ? FOR UPDATE') ? [{ ...ADMIN_ROW }] : [],
    });
    await expect(service.update('1', {}, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });
});

describe('UsersService.create', () => {
  it('用户名重复（预检）→ 30002', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user WHERE username')) return [{ id: '5' }];
        return [];
      },
    });
    await expect(
      service.create(
        { username: 'admin', name: '重复', password: 'Passw0rd!', role: 'admin' },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_CONFLICT });
  });

  it('并发唯一键冲突（1062）→ 30002', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user WHERE username')) return [];
        if (sql.startsWith('INSERT INTO sys_user')) {
          throw Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
        return [];
      },
    });
    await expect(
      service.create(
        { username: 'newuser', name: '新用户', password: 'Passw0rd!', role: 'operator' },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_CONFLICT });
  });

  it('成功：插入 + 审计同事务；响应不含 password_hash', async () => {
    const { service, audit } = makeHarness({
      query: async (sql) => {
        if (sql.includes('FROM sys_user WHERE username')) return [];
        if (sql.startsWith('INSERT INTO sys_user')) return { insertId: '24' };
        return [
          {
            id: '24',
            username: 'operator24',
            name: '示例操作员',
            dept: null,
            post: null,
            role: 'operator',
            phone: null,
            enabled: 1,
          },
        ];
      },
    });
    const result = await service.create(
      { username: 'operator24', name: '示例操作员', password: 'Passw0rd!', role: 'operator' },
      CONTEXT,
    );
    expect(result).toMatchObject({ id: '24', username: 'operator24', role: 'operator', enabled: true });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(JSON.stringify(result)).not.toContain('password_hash');
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
});
