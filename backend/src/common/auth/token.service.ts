/**
 * JWT 配置与令牌服务 —— Q4 批准口径（S5 交接 §13.3 Q4-1/Q4-2，已批准规则与边界）。
 *
 * 已批准（Q4-1）：
 * - 算法 **HS256**；access token 有效期 **2 小时**；
 * - `iss="mes-backend"`、`aud="mes-web"`；声明至少含 sub/role/iat/exp/iss/aud；
 * - 密钥来自进程环境变量 `JWT_SECRET`（≥32 字节随机），**不落盘、不进日志**。
 *
 * 已批准（Q4-2）：
 * - 本版**不做 refresh token**；退出 = 前端清空内存令牌（服务端无黑名单）；
 * - 即时失效通过「每次请求重新读取 sys_user.enabled/role」实现。
 *
 * 未批准 / 不实现：
 * - 首登强制改密（Q4-3，sys_user 无改密状态列）；
 * - 具体密码强度策略（Q4-3 边界：长度 ≥8 且含字母与数字**尚未批准**）；
 * - 改密后令牌即时吊销（与 Q4-2 一致：旧令牌在 2 小时有效期内仍可用，不宣称即时失效）。
 */

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/** Q4-1 批准的签发者 / 受众（固定值，不随环境变化） */
export const JWT_ISSUER = 'mes-backend';
export const JWT_AUDIENCE = 'mes-web';

/** Q4-1 批准的有效期：2 小时（秒） */
export const ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/** 密钥最小长度（字节）：不足则拒绝签发/校验，保持 fail-closed */
export const JWT_SECRET_MIN_BYTES = 32;

export interface AccessTokenClaims {
  /** 用户 ID（BIGINT 十进制字符串） */
  sub: string;
  /** 签发时角色；权限判定以每次请求读取的当前记录为准 */
  role: string;
}

export interface SignedAccessToken {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('JWT_SECRET');
    // 只接受「进程环境变量提供的非空字符串」；空串视为未配置（fail-closed）
    this.secret =
      typeof raw === 'string' && raw.length >= JWT_SECRET_MIN_BYTES
        ? new TextEncoder().encode(raw)
        : null;
  }

  /** 是否已配置可用密钥（决定身份解析器是真实 JWT 还是 fail-closed 占位） */
  get enabled(): boolean {
    return this.secret !== null;
  }

  /** 签发访问令牌（HS256；iss/aud/sub/role/iat/exp 齐全） */
  async signAccessToken(claims: AccessTokenClaims): Promise<SignedAccessToken> {
    if (this.secret === null) {
      throw new InternalServerErrorException('JWT_SECRET 未配置或不足 32 字节，拒绝签发令牌');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000);

    const token = await new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(this.secret);

    return { token, expiresAt };
  }

  /**
   * 校验访问令牌：签名、算法（仅 HS256，由 jose 算法白名单保证）、
   * iss / aud / exp / nbf / sub 全部声明。任何不符直接抛错，
   * 由调用方映射为 20001 / 20002。
   */
  async verifyAccessToken(token: string): Promise<JWTPayload> {
    if (this.secret === null) {
      throw new Error('JWT_SECRET 未配置或不足 32 字节，拒绝校验令牌');
    }
    const { payload } = await jwtVerify(token, this.secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      // 时钟容忍 0 秒：过期即过期，不自动续期
      clockTolerance: 0,
    });
    return payload;
  }
}
