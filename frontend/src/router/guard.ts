/**
 * 路由守卫。
 *
 * 决策逻辑在 `access.ts`（纯函数，已单测）；本文件只负责接线与副作用。
 *
 * 规则（S4 要求第 3、4 条）：
 * - 公开路由（登录 / 403 / 404）直接放行；已登录访问登录页回首页；
 * - 受保护路由未登录 → 跳登录页，并记录**站内**返回地址（已做开放重定向防护）；
 * - 已登录但角色不允许 → 403 页（不伪装成登录失效）；
 * - 骨架预览态可进入占位页以验收布局，但**不建立认证状态、不授予业务权限**，
 *   页面须显著标注（由 `SkeletonPreviewBanner` 与占位页共同呈现）；
 * - 前端守卫只用于界面引导，**不能替代后端鉴权**（契约 §5.1）。
 */

import type { Router } from 'vue-router'

import { APP_NAME } from '@/config/app'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

import { resolveRouteAccess } from './access'

export function installRouterGuards(router: Router): void {
  router.beforeEach((to) => {
    const authStore = useAuthStore()
    const appStore = useAppStore()

    const decision = resolveRouteAccess(
      to.meta,
      typeof to.name === 'string' ? to.name : null,
      to.fullPath,
      {
        isAuthenticated: authStore.isAuthenticated,
        role: authStore.role,
        skeletonPreview: appStore.skeletonPreview,
      },
    )

    if (decision.type === 'redirect') return decision.to
    return true
  })

  router.afterEach((to) => {
    if (typeof document === 'undefined') return
    const title = to.meta.title
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  })
}
