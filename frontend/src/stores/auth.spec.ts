import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAuthStore } from './auth'

import type { SessionResponse } from '@/types/auth'

/**
 * 认证状态回归（B9 / 契约 §5.1、§5.2）。
 *
 * 关注点：
 * - 令牌只存内存；未登录时不得具备任何业务权限；
 * - **角色变化即时改变权限**（服务端每次请求复核 enabled/role，前端同步刷新）；
 * - 清空会话后权限归零（不残留旧角色能力）。
 */
function session(role: SessionResponse['user']['role'], name = '测试用户'): SessionResponse {
  return {
    accessToken: 'memory-only-token',
    tokenType: 'Bearer',
    expiresAt: '2026-10-13T23:00:00.000Z',
    user: { id: '1', username: 'tester', name, role },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useAuthStore —— 会话与权限', () => {
  it('默认未登录：无角色、无权限、不可访问任何受保护页', () => {
    const store = useAuthStore()
    expect(store.isAuthenticated).toBe(false)
    expect(store.role).toBeNull()
    expect(store.permissions).toEqual([])
    expect(store.can('users:read')).toBe(false)
    expect(store.canAccessPage([])).toBe(false)
  })

  it('登录后按角色授予权限（admin 可读用户，operator 不可）', () => {
    const store = useAuthStore()
    store.setSession(session('admin'))
    expect(store.isAuthenticated).toBe(true)
    expect(store.role).toBe('admin')
    expect(store.can('users:read')).toBe(true)
    expect(store.can('users:write')).toBe(true)
  })

  it('角色变化即时改变权限（operator 不具备用户管理权限，但可报工）', () => {
    const store = useAuthStore()
    store.setSession(session('admin'))
    expect(store.can('users:read')).toBe(true)

    // 服务端把角色改为 operator 后，前端重新载入会话
    store.setSession(session('operator'))
    expect(store.role).toBe('operator')
    expect(store.can('users:read')).toBe(false)
    expect(store.can('reports:create')).toBe(true)
    expect(store.canAccessPage(['operator'])).toBe(true)
    expect(store.canAccessPage(['admin'])).toBe(false)
  })

  it('清空会话后权限归零（不残留旧角色能力）', () => {
    const store = useAuthStore()
    store.setSession(session('admin'))
    store.setProfile({
      id: '1',
      username: 'tester',
      name: '测试用户',
      dept: null,
      post: null,
      role: 'admin',
      phone: null,
      enabled: true,
    })
    store.clearSession()
    expect(store.isAuthenticated).toBe(false)
    expect(store.accessToken).toBeNull()
    expect(store.role).toBeNull()
    expect(store.permissions).toEqual([])
    expect(store.can('users:read')).toBe(false)
  })

  it('未登录角色下 canAccessPage([]) 仍为 false（仅登录页可进）', () => {
    const store = useAuthStore()
    expect(store.canAccessPage([])).toBe(false)
    store.setSession(session('operator'))
    expect(store.canAccessPage([])).toBe(true)
  })
})
