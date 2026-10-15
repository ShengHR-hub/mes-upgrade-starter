import { describe, expect, it } from 'vitest'

import { MODULES, pageRolesOf } from './modules'
import { hasPermission, permissionsOf, rolesForPermission } from './permissions'
import { ROLES, type Role } from '@/types/role'

const ALL_ROLES: readonly Role[] = ROLES

describe('权限矩阵 · 与契约 §5.2 抽样核对', () => {
  it('登录与自身资料对所有角色开放', () => {
    expect(rolesForPermission('sessions:login')).toEqual(ALL_ROLES)
    expect(rolesForPermission('users:me:read')).toEqual(ALL_ROLES)
    expect(rolesForPermission('users:me:password-change')).toEqual(ALL_ROLES)
  })

  it('主数据读取对三角色开放，写入仅 admin / manager', () => {
    for (const key of ['products:read', 'materials:read', 'boms:read', 'process-routes:read'] as const) {
      expect(rolesForPermission(key), key).toEqual(ALL_ROLES)
    }
    expect(rolesForPermission('boms:write')).toEqual(['admin', 'manager'])
    expect(rolesForPermission('materials:safety-stock:write')).toEqual(['admin', 'manager'])
  })

  it('订单与工单写入仅 admin / manager，查看对三角色开放', () => {
    expect(rolesForPermission('orders:read')).toEqual(['admin', 'manager'])
    expect(rolesForPermission('orders:write')).toEqual(['admin', 'manager'])
    expect(rolesForPermission('work-orders:read')).toEqual(ALL_ROLES)
    expect(rolesForPermission('tasks:read')).toEqual(ALL_ROLES)
    expect(rolesForPermission('work-orders:write')).toEqual(['admin', 'manager'])
    expect(rolesForPermission('tasks:write')).toEqual(['admin', 'manager'])
  })

  it('报工 / 检验 / 批次 / SN 对三角色开放', () => {
    for (const key of [
      'reports:read',
      'reports:create',
      'quality-inspections:read',
      'quality-inspections:create',
      'defects:read',
      'material-batches:read',
      'material-batches:create',
      'sn-traces:read',
      'sn-traces:write',
      'sn-traces:export',
    ] as const) {
      expect(rolesForPermission(key), key).toEqual(ALL_ROLES)
    }
  })

  it('设备状态流转对三角色开放，但 OEE 仅 admin / manager', () => {
    expect(rolesForPermission('devices:read')).toEqual(ALL_ROLES)
    expect(rolesForPermission('devices:transition')).toEqual(ALL_ROLES)
    expect(rolesForPermission('devices:oee:read')).toEqual(['admin', 'manager'])
  })

  it('看板 / 月报 / 预警 / 问数 / SPC / MRP 不含 operator', () => {
    for (const key of [
      'dashboards:read',
      'monthly-reports:create',
      'alerts:read',
      'alerts:transition',
      'data-queries:create',
      'quality-analyses:read',
      'material-requirement-calculations:create',
    ] as const) {
      expect(rolesForPermission(key), key).toEqual(['admin', 'manager'])
    }
  })

  it('F4 根因与 F2 日报仅 admin', () => {
    expect(rolesForPermission('alerts:root-cause:create')).toEqual(['admin'])
    expect(rolesForPermission('daily-reports:create')).toEqual(['admin'])
  })

  it('F1 知识问答对三角色开放', () => {
    expect(rolesForPermission('rag-answers:create')).toEqual(ALL_ROLES)
    expect(rolesForPermission('knowledge-sources:read')).toEqual(ALL_ROLES)
  })

  it('用户与权限、审计日志仅 admin', () => {
    for (const key of ['users:read', 'users:write', 'role-permissions:read', 'audit-logs:read', 'ai-query-logs:read'] as const) {
      expect(rolesForPermission(key), key).toEqual(['admin'])
    }
  })

  it('B14 开放 API 本版未启用，任何角色都不可访问', () => {
    expect(rolesForPermission('integrations:erp-orders:create')).toEqual([])
    expect(rolesForPermission('integrations:device-events:create')).toEqual([])
    for (const role of ROLES) {
      expect(hasPermission(role, 'integrations:erp-orders:create')).toBe(false)
      expect(hasPermission(role, 'integrations:device-events:create')).toBe(false)
    }
  })
})

describe('页面可见角色 · 逐模块核对', () => {
  const expected: Readonly<Record<string, readonly Role[]>> = {
    home: ALL_ROLES,
    orders: ['admin', 'manager'],
    'work-orders': ALL_ROLES,
    reports: ALL_ROLES,
    'quality-inspections': ALL_ROLES,
    dashboard: ['admin', 'manager'],
    alerts: ['admin', 'manager'],
    'quality-analyses': ['admin', 'manager'],
    'ai-daily-report': ['admin'],
    'ai-data-query': ['admin', 'manager'],
    'ai-knowledge': ALL_ROLES,
    materials: ALL_ROLES,
    'sn-traces': ALL_ROLES,
    mrp: ['admin', 'manager'],
    devices: ALL_ROLES,
    users: ['admin'],
    logs: ['admin'],
  }

  it('模块数量与清单一致', () => {
    expect(MODULES.length).toBe(Object.keys(expected).length)
  })

  it.each(Object.keys(expected))('%s 的可见角色正确', (key) => {
    const moduleDefinition = MODULES.find((item) => item.key === key)
    expect(moduleDefinition, `缺少模块配置 ${key}`).toBeDefined()
    expect([...pageRolesOf(moduleDefinition!)].sort()).toEqual([...expected[key]!].sort())
  })
})

describe('权限与角色的推导关系', () => {
  it('permissionsOf 与 hasPermission 一致', () => {
    for (const role of ROLES) {
      const permissions = permissionsOf(role)
      for (const permission of permissions) {
        expect(hasPermission(role, permission)).toBe(true)
      }
    }
  })

  it('admin 的权限数不少于 manager，manager 不少于 operator', () => {
    const admin = permissionsOf('admin').length
    const manager = permissionsOf('manager').length
    const operator = permissionsOf('operator').length
    expect(admin).toBeGreaterThanOrEqual(manager)
    expect(manager).toBeGreaterThanOrEqual(operator)
  })

  it('「能进页面」不等于「能执行所有操作」：工单页 operator 可读不可写', () => {
    expect(hasPermission('operator', 'work-orders:read')).toBe(true)
    expect(hasPermission('operator', 'work-orders:write')).toBe(false)
    expect(hasPermission('operator', 'tasks:write')).toBe(false)
  })
})
