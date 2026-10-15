import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';

import { ErrorCode } from '../constants/error-code.js';

import { JwtIdentityResolver } from './jwt-identity-resolver.js';
import { JWT_AUDIENCE, JWT_ISSUER, TokenService } from './token.service.js';

/**
 * JWT 身份解析器测试 —— 真实 jose + 替身数据源（不连数据库）。
 *
 * 覆盖任务书 §九.7：停用账号与角色变化对已有令牌的即时权限影响；
 * 以及不接受请求体/自定义头/固定账号作为身份的边界。
 */

const TEST_SECRET = 's10-resolver-secret-0123456789abcdef0123456789abcdef';
const KEY = new TextEncoder().encode(TEST_SECRET);

function tokens(): TokenService {
  return new TokenService({ get: (key: string) => (key === 'JWT_SECRET' ? TEST_SECRET : undefined) } as never);
}

async function issueToken(sub: string, role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('2h')
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(KEY);
}

function dataSourceReturning(
  rows: Array<{ id: string; username: string; name: string; role: string; enabled: number }>,
): never {
  return { query: async () => rows } as never;
}

describe('JwtIdentityResolver', () => {
  it('无 Authorization 头 → null（由守卫统一 20001）', async () => {
    const resolver = new JwtIdentityResolver(tokens(), dataSourceReturning([]));
    expect(await resolver.resolve({ headers: {} })).toBeNull();
    expect(await resolver.resolve({})).toBeNull();
  });

  it('非 Bearer 方案 / 空令牌 → null', async () => {
    const resolver = new JwtIdentityResolver(tokens(), dataSourceReturning([]));
    expect(await resolver.resolve({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(await resolver.resolve({ headers: { authorization: 'Bearer ' } })).toBeNull();
  });

  it('伪造签名 → 20001', async () => {
    const forged = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(new TextEncoder().encode('attacker-0123456789abcdef0123456789abcdef'));
    const resolver = new JwtIdentityResolver(tokens(), dataSourceReturning([]));
    await expect(
      resolver.resolve({ headers: { authorization: `Bearer ${forged}` } }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it('过期令牌 → 20002', async () => {
    const expired = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(KEY);
    const resolver = new JwtIdentityResolver(tokens(), dataSourceReturning([]));
    await expect(
      resolver.resolve({ headers: { authorization: `Bearer ${expired}` } }),
    ).rejects.toMatchObject({ code: ErrorCode.TOKEN_EXPIRED });
  });

  it('合法令牌 → 返回服务端身份（id/sub 与库记录一致）', async () => {
    const token = await issueToken('7', 'manager');
    const resolver = new JwtIdentityResolver(
      tokens(),
      dataSourceReturning([
        { id: '7', username: 'm1', name: '王经理', role: 'manager', enabled: 1 },
      ]),
    );
    const user = await resolver.resolve({ headers: { authorization: `Bearer ${token}` } });
    expect(user).toEqual({ id: '7', role: 'manager', username: 'm1', name: '王经理' });
  });

  it('角色变化：令牌里是 admin，库里已改为 operator → 按当前库记录降权', async () => {
    const token = await issueToken('7', 'admin');
    const resolver = new JwtIdentityResolver(
      tokens(),
      dataSourceReturning([
        { id: '7', username: 'm1', name: '王经理', role: 'operator', enabled: 1 },
      ]),
    );
    const user = await resolver.resolve({ headers: { authorization: `Bearer ${token}` } });
    expect(user?.role).toBe('operator');
  });

  it('停用账号：未过期令牌立即失效 → 20004（Q4-2 即时失效口径）', async () => {
    const token = await issueToken('8', 'operator');
    const resolver = new JwtIdentityResolver(
      tokens(),
      dataSourceReturning([
        { id: '8', username: 'op1', name: '操作员', role: 'operator', enabled: 0 },
      ]),
    );
    await expect(
      resolver.resolve({ headers: { authorization: `Bearer ${token}` } }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('账号已删除 → 20001', async () => {
    const token = await issueToken('9', 'operator');
    const resolver = new JwtIdentityResolver(tokens(), dataSourceReturning([]));
    await expect(
      resolver.resolve({ headers: { authorization: `Bearer ${token}` } }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it('sub 非十进制 ID → 20001（不接受任意声明当身份）', async () => {
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-an-id')
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(KEY);
    const resolver = new JwtIdentityResolver(tokens(), dataSourceReturning([]));
    await expect(
      resolver.resolve({ headers: { authorization: `Bearer ${token}` } }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });
});
