import type { Request } from 'express';

import type { AuthenticatedUser } from './identity.types.js';

/**
 * 身份解析器注入令牌。
 *
 * 隔离测试可用 `overrideProvider(IDENTITY_RESOLVER)` 注入身份替身；
 * **身份替身不得进入正常启动路径**（正常启动只有 `NoAuthIdentityResolver`）。
 */
export const IDENTITY_RESOLVER = 'MES_IDENTITY_RESOLVER';

export interface IdentityResolver {
  resolve(request: Request): Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
}

/**
 * 默认身份解析器：**永远返回 null**（fail-closed）。
 *
 * 设计依据（S5 任务书「前置决策检查」第 5～8 条）：
 * - 本版未实现 JWT（Q4 未决、B9 属 S10），不存在可信身份来源；
 * - 因此**拒绝把任何客户端可控信息当作身份**：
 *   - 不使用请求体里的 `role` / `userId`；
 *   - 不使用前端骨架预览身份；
 *   - 不使用普通自定义请求头；
 *   - 不使用任何固定内置用户。
 * - 无法建立可信身份时返回 null，由 `AuthGuard` 统一转成 `20001 UNAUTHENTICATED`，
 *   从而保证「不允许匿名创建、修改或确认订单」。
 *
 * 真实登录与令牌校验须待 Q4 决策后由 B9 会话实现；届时只需替换本解析器的实现，
 * 控制器、守卫与权限矩阵均无需改动。
 */
export class NoAuthIdentityResolver implements IdentityResolver {
  resolve(): AuthenticatedUser | null {
    return null;
  }
}
