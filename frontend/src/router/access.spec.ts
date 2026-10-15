import { describe, expect, it } from 'vitest'

import { findModuleByKey, pageRolesOf } from '@/config/modules'
import type { Role } from '@/types/role'

import { resolveRouteAccess, type AccessContext } from './access'

/** 用「不含真实令牌」的测试身份构造上下文 */
function identity(role: Role | null, options: { preview?: boolean } = {}): AccessContext {
  return {
    isAuthenticated: role !== null,
    role,
    skeletonPreview: options.preview ?? false,
  }
}

function metaOf(moduleKey: string) {
  const moduleDefinition = findModuleByKey(moduleKey)
  if (!moduleDefinition) throw new Error(`未找到模块配置：${moduleKey}`)
  return { requiresAuth: true, roles: pageRolesOf(moduleDefinition) }
}

const PUBLIC_META = { public: true }

describe('resolveRouteAccess · 公开页', () => {
  it('未登录可访问登录页 / 403 / 404', () => {
    expect(resolveRouteAccess(PUBLIC_META, 'login', '/login', identity(null))).toEqual({ type: 'allow' })
    expect(resolveRouteAccess(PUBLIC_META, 'forbidden', '/403', identity(null))).toEqual({ type: 'allow' })
    expect(resolveRouteAccess(PUBLIC_META, 'not-found', '/404', identity(null))).toEqual({ type: 'allow' })
  })

  it('已登录访问登录页 → 回首页', () => {
    const decision = resolveRouteAccess(PUBLIC_META, 'login', '/login', identity('admin'))
    expect(decision).toEqual({ type: 'redirect', to: { name: 'home' } })
  })
})

describe('resolveRouteAccess · 未登录（匿名）', () => {
  it('受保护页面跳登录页并记录站内返回地址', () => {
    const decision = resolveRouteAccess(metaOf('orders'), 'orders', '/orders?page=2', identity(null))
    expect(decision).toEqual({
      type: 'redirect',
      to: { name: 'login', query: { redirect: '/orders?page=2' } },
    })
  })

  it('返回地址中的外部地址被清洗', () => {
    const decision = resolveRouteAccess(metaOf('orders'), 'orders', '//evil.example.com', identity(null))
    expect(decision).toEqual({ type: 'redirect', to: { name: 'login', query: { redirect: '/' } } })
  })

  it('匿名不能执行任何业务页面（逐模块检查）', () => {
    for (const key of ['orders', 'work-orders', 'reports', 'quality-inspections', 'dashboard', 'alerts', 'users', 'logs']) {
      const decision = resolveRouteAccess(metaOf(key), key, `/${key}`, identity(null))
      expect(decision.type, `模块 ${key} 不应允许匿名访问`).toBe('redirect')
    }
  })
})

describe('resolveRouteAccess · 已登录三角色（对照契约 §5.2）', () => {
  it('admin 可访问全部已实现页面（除未启用的集成接口）', () => {
    for (const key of ['orders', 'work-orders', 'reports', 'quality-inspections', 'dashboard', 'alerts', 'quality-analyses', 'ai-daily-report', 'ai-data-query', 'ai-knowledge', 'materials', 'sn-traces', 'mrp', 'devices', 'users', 'logs']) {
      expect(resolveRouteAccess(metaOf(key), key, `/${key}`, identity('admin')).type, `admin → ${key}`).toBe('allow')
    }
  })

  it('manager 被拒于 admin 专属页面（用户与权限、审计日志、AI 日报）', () => {
    for (const key of ['users', 'logs', 'ai-daily-report']) {
      const decision = resolveRouteAccess(metaOf(key), key, `/${key}`, identity('manager'))
      expect(decision.type, `manager → ${key} 应被拒`).toBe('redirect')
      if (decision.type === 'redirect') {
        expect(decision.to.name).toBe('forbidden')
        expect(decision.to.query?.from).toBe(`/${key}`)
      }
    }
  })

  it('manager 可访问订单、工单、看板、预警、问数、SPC、MRP', () => {
    for (const key of ['orders', 'work-orders', 'dashboard', 'alerts', 'ai-data-query', 'quality-analyses', 'mrp']) {
      expect(resolveRouteAccess(metaOf(key), key, `/${key}`, identity('manager')).type, `manager → ${key}`).toBe('allow')
    }
  })

  it('operator 被拒于订单、看板、预警、SPC、MRP、AI 日报、问数、用户与日志', () => {
    for (const key of ['orders', 'dashboard', 'alerts', 'quality-analyses', 'mrp', 'ai-daily-report', 'ai-data-query', 'users', 'logs']) {
      expect(resolveRouteAccess(metaOf(key), key, `/${key}`, identity('operator')).type, `operator → ${key} 应被拒`).toBe('redirect')
    }
  })

  it('operator 可访问报工、检验、工单查看、SN 追溯、设备、知识问答、物料', () => {
    for (const key of ['reports', 'quality-inspections', 'work-orders', 'sn-traces', 'devices', 'ai-knowledge', 'materials']) {
      expect(resolveRouteAccess(metaOf(key), key, `/${key}`, identity('operator')).type, `operator → ${key}`).toBe('allow')
    }
  })
})

describe('resolveRouteAccess · 骨架预览', () => {
  it('预览可进入占位页以检查布局', () => {
    expect(resolveRouteAccess(metaOf('users'), 'users', '/users', identity(null, { preview: true }))).toEqual({
      type: 'allow',
    })
  })

  it('预览不影响公开页规则', () => {
    expect(
      resolveRouteAccess(PUBLIC_META, 'login', '/login', identity(null, { preview: true })),
    ).toEqual({ type: 'allow' })
  })

  it('关闭预览后匿名仍被拦截（预览态只存在于内存）', () => {
    const decision = resolveRouteAccess(metaOf('users'), 'users', '/users', identity(null, { preview: false }))
    expect(decision.type).toBe('redirect')
  })
})
