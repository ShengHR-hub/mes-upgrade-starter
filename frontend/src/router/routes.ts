/**
 * 路由表：由 `config/modules.ts` 单一配置源派生（命名 + 懒加载 + meta）。
 *
 * 结构：
 * - `/login`、`/403`、`/404` 为独立页面（不套用后台布局）；
 * - 其余业务页面统一挂在 `AppLayout` 下，`meta.requiresAuth = true`；
 * - 未知路径由 `/:pathMatch(.*)*` 兜底重定向到 404。
 */

import type { RouteRecordRaw } from 'vue-router'

import { MODULES, pageRolesOf } from '@/config/modules'

const AppLayout = () => import('@/layouts/AppLayout.vue')
const ModulePlaceholderView = () => import('@/views/ModulePlaceholderView.vue')
const LoginView = () => import('@/views/LoginView.vue')
const ForbiddenView = () => import('@/views/error/ForbiddenView.vue')
const NotFoundView = () => import('@/views/error/NotFoundView.vue')
const MobileWorkbenchView = () => import('@/views/mobile/MobileWorkbenchView.vue')

function moduleChildRoutes(): RouteRecordRaw[] {
  return MODULES.map((module) => {
    const loader = module.component ?? (() => ModulePlaceholderView())
    const route = {
      path: module.path === '/' ? '' : module.path.replace(/^\//, ''),
      name: module.key,
      component: loader as unknown as RouteRecordRaw['component'],
      meta: {
        title: module.title,
        requiresAuth: true,
        roles: pageRolesOf(module),
        moduleKey: module.key,
        groupKey: module.group,
        code: module.code,
        summary: module.summary,
        plannedApis: module.plannedApis,
        implemented: module.implemented,
      },
    }
    // RouteRecordRaw 是联合类型，字面量需显式断言为“带 component 的普通路由”
    return route as RouteRecordRaw
  })
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    meta: { title: '登录', public: true },
  },
  {
    path: '/403',
    name: 'forbidden',
    component: ForbiddenView,
    meta: { title: '无访问权限', public: true },
  },
  {
    path: '/404',
    name: 'not-found',
    component: NotFoundView,
    meta: { title: '页面不存在', public: true },
  },
  {
    path: '/',
    component: AppLayout,
    children: moduleChildRoutes(),
  },
  {
    // B13 移动端 PWA 工作台：独立全屏页面（不套桌面布局），仍需登录。
    // 复用全部现有业务 API 与同一套 JWT/RBAC，不新增移动端专用权限。
    path: '/mobile',
    name: 'mobile',
    component: MobileWorkbenchView,
    meta: { title: 'MES 移动工作台', requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found-catch-all',
    redirect: (to) => ({ name: 'not-found', query: { from: to.fullPath } }),
  },
]
