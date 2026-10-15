import { describe, expect, it } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';

import { ErrorCode } from '../constants/error-code.js';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET_MIN_BYTES,
  TokenService,
} from './token.service.js';

/**
 * JWT 令牌服务测试 —— 真实 jose 实现 + 测试密钥（不连数据库）。
 *
 * 覆盖任务书 §九.6：伪造签名、过期、算法错误、签发者/受众错误。
 * 密钥来自测试进程环境变量（本文件显式构造 ConfigService 替身，不读取真实 .env）。
 */

const TEST_SECRET = 's10-test-secret-0123456789abcdef0123456789abcdef'; // ≥32 字节

function configWith(secret: string | undefined): never {
  return { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) } as never;
}

describe('TokenService 启用门禁', () => {
  it('未配置 JWT_SECRET → enabled=false（fail-closed，不签发不校验）', () => {
    const service = new TokenService(configWith(undefined));
    expect(service.enabled).toBe(false);
  });

  it('密钥不足 32 字节 → enabled=false', () => {
    const service = new TokenService(configWith('too-short'));
    expect(service.enabled).toBe(false);
    expect(JWT_SECRET_MIN_BYTES).toBe(32);
  });

  it('合规密钥 → enabled=true', () => {
    const service = new TokenService(configWith(TEST_SECRET));
    expect(service.enabled).toBe(true);
  });
});

describe('TokenService 签发与校验（Q4-1 批准口径）', () => {
  const service = new TokenService(configWith(TEST_SECRET));

  it('签发：HS256 + sub/role/iat/exp/iss/aud；有效期 2 小时', async () => {
    const { token, expiresAt } = await service.signAccessToken({ sub: '1', role: 'admin' });
    expect(typeof token).toBe('string');

    const key = new TextEncoder().encode(TEST_SECRET);
    const { payload, protectedHeader } = await jwtVerify(token, key);
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe('1');
    expect(payload.role).toBe('admin');
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.aud).toBe(JWT_AUDIENCE);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    // 有效期正好 2 小时（Q4-1）
    expect((payload.exp as number) - (payload.iat as number)).toBe(ACCESS_TOKEN_TTL_SECONDS);

    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(ACCESS_TOKEN_TTL_SECONDS * 1000 - 5000);
    expect(ttlMs).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_SECONDS * 1000);
  });

  it('校验通过：返回 payload', async () => {
    const { token } = await service.signAccessToken({ sub: '42', role: 'manager' });
    const payload = await service.verifyAccessToken(token);
    expect(payload.sub).toBe('42');
    expect(payload.role).toBe('manager');
  });

  it('伪造签名（错误的密钥签发）→ 校验失败', async () => {
    const forged = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(new TextEncoder().encode('attacker-key-0123456789abcdef0123456789abcdef'));
    await expect(service.verifyAccessToken(forged)).rejects.toThrow();
  });

  it('篡改 payload（改 role 为 admin）→ 签名不匹配，校验失败', async () => {
    const { token } = await service.signAccessToken({ sub: '2', role: 'operator' });
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(JSON.stringify({ sub: '2', role: 'admin' })).toString('base64url');
    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signature}`),
    ).rejects.toThrow();
  });

  it('过期令牌 → ERR_JWT_EXPIRED（供解析器映射 20002）', async () => {
    const expired = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(new TextEncoder().encode(TEST_SECRET));
    await expect(service.verifyAccessToken(expired)).rejects.toMatchObject({
      code: 'ERR_JWT_EXPIRED',
    });
  });

  it('算法错误（alg=none）→ 校验失败', async () => {
    // jose 拒绝签发 alg=none，这里手工组装「无签名」令牌，验证校验端不放过它
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '1',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7200,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
      }),
    ).toString('base64url');
    await expect(service.verifyAccessToken(`${header}.${payload}.`)).rejects.toThrow();
  });

  it('签发者错误 → 校验失败', async () => {
    const wrongIss = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer('evil-issuer')
      .setAudience(JWT_AUDIENCE)
      .sign(new TextEncoder().encode(TEST_SECRET));
    await expect(service.verifyAccessToken(wrongIss)).rejects.toThrow();
  });

  it('受众错误 → 校验失败', async () => {
    const wrongAud = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_ISSUER)
      .setAudience('evil-audience')
      .sign(new TextEncoder().encode(TEST_SECRET));
    await expect(service.verifyAccessToken(wrongAud)).rejects.toThrow();
  });

  it('未配置密钥时签发/校验均拒绝（fail-closed）', async () => {
    const disabled = new TokenService(configWith(undefined));
    await expect(
      disabled.signAccessToken({ sub: '1', role: 'admin' }),
    ).rejects.toBeTruthy();
    await expect(disabled.verifyAccessToken('a.b.c')).rejects.toBeTruthy();
    expect(ErrorCode.UNAUTHENTICATED).toBe(20001);
  });
});
