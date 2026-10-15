/**
 * 路由访问决策（纯函数，便于单测）。
 *
 * 与 `guard.ts` 的关系：守卫只负责把 store 状态喂进来并执行决策结果，
 * 决策逻辑集中在此，可用「不含真实令牌的测试身份」直接验证三角色配置。
 *
 * ⚠️ 这只是界面引导层，不能替代后端鉴权（契约 §5.1）。
 */

import { sanitizeRedirect } from './redirect'

import type { Role } from '@/types/role'

export interface RouteAccessMeta {
  public?: boolean
  requiresAuth?: boolean
  roles?: readonly Role[]
}

export interface AccessContext {
  isAuthenticated: boolean
  role: Role | null
  skeletonPreview: boolean
}

export interface NavigationRedirect {
  name: string
  query?: Record<string, string>
}

export type NavigationDecision = { type: 'allow' } | { type: 'redirect'; to: NavigationRedirect }

export function resolveRouteAccess(
  meta: RouteAccessMeta,
  routeName: string | null | undefined,
  fullPath: string,
  context: AccessContext,
): NavigationDecision {
  // 公开页面：已登录时不再停留在登录页
  if (meta.public) {
    if (routeName === 'login' && context.isAuthenticated) {
      return { type: 'redirect', to: { name: 'home' } }
    }
    return { type: 'allow' }
  }

  if (!meta.requiresAuth) return { type: 'allow' }

  if (context.isAuthenticated) {
    const roles = meta.roles ?? []
    if (roles.length > 0 && (context.role === null || !roles.includes(context.role))) {
      return { type: 'redirect', to: { name: 'forbidden', query: { from: sanitizeRedirect(fullPath) } } }
    }
    return { type: 'allow' }
  }

  // 骨架预览：允许进入占位页检查布局；不建立认证状态、不授予业务权限
  if (context.skeletonPreview) return { type: 'allow' }

  return { type: 'redirect', to: { name: 'login', query: { redirect: sanitizeRedirect(fullPath) } } }
}
