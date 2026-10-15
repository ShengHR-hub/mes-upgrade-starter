/**
 * 细粒度权限矩阵 —— 严格照抄 `docs/api-contract.md` §5.2 的三角色表。
 *
 * 设计目的（S4 要求第 3 条）：
 * 「为组合模块预留细粒度权限，不把『能进页面』等同于『能执行所有操作』」。
 *
 * 因此这里按 **接口组/操作** 维度声明权限，再由 `modules.ts` 用「读权限」
 * 推导页面可见角色；写权限单独保留，供后续模块控制按钮显隐与调用前置校验。
 *
 * 维护规则：任何一行若与契约 §5.2 不一致，以契约为准并同步修订本文件。
 */

import { ROLES, type Role } from '@/types/role'

const ALL: readonly Role[] = ROLES
const ADMIN_MANAGER: readonly Role[] = ['admin', 'manager']
const ADMIN_ONLY: readonly Role[] = ['admin']
const NONE: readonly Role[] = []

export const PERMISSION_MATRIX = {
  // ---- 认证与自身资料（契约 §5.2 第 1、2 行）----
  'sessions:login': ALL,
  'users:me:read': ALL,
  'users:me:password-change': ALL,

  // ---- 主数据读取：产品 / 物料 / 产品 BOM / 工艺路线（§5.2 第 3 行）----
  'products:read': ALL,
  'materials:read': ALL,
  'boms:read': ALL,
  'process-routes:read': ALL,

  // ---- 主数据写入（§5.2 第 4 行：POST/PATCH 产品 BOM；DELETE BOM；PATCH 物料安全库存）----
  'boms:write': ADMIN_MANAGER,
  'materials:safety-stock:write': ADMIN_MANAGER,

  // ---- B1 生产订单（§5.2 第 5 行）----
  'orders:read': ADMIN_MANAGER,
  'orders:write': ADMIN_MANAGER,

  // ---- B2 工单与工序任务（§5.2 第 6、7 行）----
  'work-orders:read': ALL,
  'tasks:read': ALL,
  'work-orders:write': ADMIN_MANAGER,
  'tasks:write': ADMIN_MANAGER,

  // ---- B3 工序报工（§5.2 第 8 行）----
  'reports:read': ALL,
  'reports:create': ALL,

  // ---- B4 质量检验（§5.2 第 9 行）----
  'quality-inspections:read': ALL,
  'quality-inspections:create': ALL,
  'defects:read': ALL,

  // ---- B5 批次 / B6 SN 追溯（§5.2 第 10、11 行）----
  'material-batches:read': ALL,
  'material-batches:create': ALL,
  'sn-traces:read': ALL,
  'sn-traces:write': ALL,
  'sn-traces:export': ALL,

  // ---- B7 设备（§5.2 第 12、13、14 行）----
  'devices:read': ALL,
  'device-logs:read': ALL,
  'devices:transition': ALL,
  'devices:oee:read': ADMIN_MANAGER,

  // ---- B8 经营驾驶舱与月报（§5.2 第 15 行）----
  'dashboards:read': ADMIN_MANAGER,
  'monthly-reports:create': ADMIN_MANAGER,

  // ---- B10 预警中心（§5.2 第 16 行）与 F4 根因（第 17 行，仅 admin）----
  'alerts:read': ADMIN_MANAGER,
  'alerts:transition': ADMIN_MANAGER,
  'alerts:root-cause:create': ADMIN_ONLY,

  // ---- F3 智能问数 / F2 日报（§5.2 第 18、19 行）----
  'data-queries:create': ADMIN_MANAGER,
  'daily-reports:create': ADMIN_ONLY,

  // ---- F1 RAG 知识问答（§5.2 第 20 行）----
  'rag-answers:create': ALL,
  'knowledge-sources:read': ALL,

  // ---- B11 SPC / B12 MRP-lite（§5.2 第 21、22 行）----
  'quality-analyses:read': ADMIN_MANAGER,
  'material-requirement-calculations:create': ADMIN_MANAGER,

  // ---- B9 用户与权限、审计日志（§5.2 第 23 行）----
  'users:read': ADMIN_ONLY,
  'users:write': ADMIN_ONLY,
  'role-permissions:read': ADMIN_ONLY,
  'audit-logs:read': ADMIN_ONLY,
  'ai-query-logs:read': ADMIN_ONLY,

  // ---- B14 开放 API：本版「未启用」，任何角色都不可访问（§5.2 第 24 行）----
  'integrations:erp-orders:create': NONE,
  'integrations:device-events:create': NONE,
} as const satisfies Readonly<Record<string, readonly Role[]>>

export type PermissionKey = keyof typeof PERMISSION_MATRIX

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_MATRIX) as PermissionKey[]

/** 某个角色是否拥有指定权限 */
export function hasPermission(role: Role, permission: PermissionKey): boolean {
  return PERMISSION_MATRIX[permission].includes(role)
}

/** 指定权限允许的角色集合（只读） */
export function rolesForPermission(permission: PermissionKey): readonly Role[] {
  return PERMISSION_MATRIX[permission]
}

/** 某角色拥有的全部权限（可用于调试与 `GET /role-permissions` 前端侧对照） */
export function permissionsOf(role: Role): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) => hasPermission(role, key))
}

/** 至少拥有其中一个权限 */
export function hasAnyPermission(role: Role, permissions: readonly PermissionKey[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission))
}
