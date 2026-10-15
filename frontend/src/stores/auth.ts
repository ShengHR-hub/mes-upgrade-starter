/**
 * 认证状态。
 *
 * 安全约束（S4 要求第 4 条）：
 * - 访问令牌**只存内存**（Pinia state），不写 localStorage / sessionStorage；
 * - 不保存、不打印密码；
 * - 不预设刷新令牌方案；
 * - 默认未登录；`isAuthenticated` 必须同时具备令牌与服务端返回的用户身份，
 *   不允许用「骨架预览」或本地假数据伪造登录态。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { hasAnyPermission, hasPermission, permissionsOf, type PermissionKey } from '@/config/permissions'
import type { CurrentUser, SessionResponse, SessionUser } from '@/types/auth'
import type { Role } from '@/types/role'

export const useAuthStore = defineStore('auth', () => {
  /** 访问令牌 —— 仅内存，刷新即丢失（符合「不预设刷新方案」的当前边界） */
  const accessToken = ref<string | null>(null)
  /** 登录响应携带的用户身份（服务端返回，非本地构造） */
  const sessionUser = ref<SessionUser | null>(null)
  /** `GET /users/me` 的补充资料 */
  const profile = ref<CurrentUser | null>(null)
  /** 令牌过期时间（来自登录响应，仅用于展示/后续判断，不做自动刷新） */
  const expiresAt = ref<string | null>(null)

  const isAuthenticated = computed(() => accessToken.value !== null && sessionUser.value !== null)

  const role = computed<Role | null>(() => sessionUser.value?.role ?? profile.value?.role ?? null)

  const displayName = computed<string | null>(() => profile.value?.name ?? sessionUser.value?.name ?? null)

  const username = computed<string | null>(() => sessionUser.value?.username ?? profile.value?.username ?? null)

  const permissions = computed<readonly PermissionKey[]>(() =>
    role.value === null ? [] : permissionsOf(role.value),
  )

  function setSession(session: SessionResponse): void {
    accessToken.value = session.accessToken
    sessionUser.value = session.user
    expiresAt.value = session.expiresAt
  }

  function setProfile(user: CurrentUser): void {
    profile.value = user
  }

  function clearSession(): void {
    accessToken.value = null
    sessionUser.value = null
    profile.value = null
    expiresAt.value = null
  }

  /** 当前身份是否可访问指定角色集合的页面（`roles` 为空表示仅需登录） */
  function canAccessPage(roles: readonly Role[]): boolean {
    if (role.value === null) return false
    if (roles.length === 0) return true
    return roles.includes(role.value)
  }

  /** 是否具备某个细粒度权限（仅用于入口显隐，不能替代后端鉴权） */
  function can(permission: PermissionKey): boolean {
    return role.value !== null && hasPermission(role.value, permission)
  }

  function canAny(permissions: readonly PermissionKey[]): boolean {
    return role.value !== null && hasAnyPermission(role.value, permissions)
  }

  return {
    accessToken,
    sessionUser,
    profile,
    expiresAt,
    isAuthenticated,
    role,
    displayName,
    username,
    permissions,
    setSession,
    setProfile,
    clearSession,
    canAccessPage,
    can,
    canAny,
  }
})
