/**
 * 认证身份类型 —— 契约 §5.1 / §5.2。
 *
 * 身份由 B9/S10 的真实 JWT 解析器提供；隔离业务测试可显式注入替身。
 * 本文件只定义「服务端可信身份」的形状，来源由 `IdentityResolver` 决定；
 * 默认实现永远返回 null（fail-closed），详见 `identity-resolver.ts`。
 */

export const ROLES = ['admin', 'manager', 'operator'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * 服务端可信身份。
 *
 * `id` 为 BIGINT 的十进制字符串（契约 §2.1），**不得**被 Number() 转换。
 */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  username?: string;
  name?: string;
}

/** 携带已解析身份的 Express 请求（由 AuthGuard 写入）。 */
export interface AuthenticatedRequest {
  user?: AuthenticatedUser;
  headers?: Record<string, unknown>;
  method?: string;
  path?: string;
  ip?: string;
}
