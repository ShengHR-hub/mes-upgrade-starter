/**
 * 后端权限矩阵 —— **权威来源**，严格照抄 `docs/api-contract.md` §5.2 三角色表。
 *
 * 与前端 `frontend/src/config/permissions.ts` 同一套 key 词汇：
 * - 后端用 `GET /role-permissions` 返回本矩阵（B9 只读查询）；
 * - 前端同名文件**只用于入口显隐**，不替代后端授权（契约 §5.1「前端路由隐藏不是鉴权」）。
 *
 * 维护规则：任何一行若与契约 §5.2 不一致，以契约为准并同步修订本文件。
 */

import { ROLES, type Role } from './identity.types.js';

const ALL: readonly Role[] = ROLES;
const ADMIN_MANAGER: readonly Role[] = ['admin', 'manager'];
const ADMIN_ONLY: readonly Role[] = ['admin'];
const NONE: readonly Role[] = [];

export const PERMISSION_MATRIX = {
  // ---- 认证与自身资料（§5.2 第 1、2 行）----
  'sessions:login': ALL,
  'users:me:read': ALL,
  'users:me:password-change': ALL,

  // ---- 主数据读取（第 3 行）----
  'products:read': ALL,
  'materials:read': ALL,
  'boms:read': ALL,
  'process-routes:read': ALL,

  // ---- 主数据写入（第 4 行）----
  'boms:write': ADMIN_MANAGER,
  'materials:safety-stock:write': ADMIN_MANAGER,

  // ---- B1 生产订单（第 5 行）----
  'orders:read': ADMIN_MANAGER,
  'orders:write': ADMIN_MANAGER,

  // ---- B2 工单与工序任务（第 6、7 行）----
  'work-orders:read': ALL,
  'tasks:read': ALL,
  'work-orders:write': ADMIN_MANAGER,
  'tasks:write': ADMIN_MANAGER,

  // ---- B3 工序报工（第 8 行）----
  'reports:read': ALL,
  'reports:create': ALL,

  // ---- B4 质量检验（第 9 行）----
  'quality-inspections:read': ALL,
  'quality-inspections:create': ALL,
  'defects:read': ALL,

  // ---- B5 批次 / B6 SN 追溯（第 10、11 行）----
  'material-batches:read': ALL,
  'material-batches:create': ALL,
  'sn-traces:read': ALL,
  'sn-traces:write': ALL,
  'sn-traces:export': ALL,

  // ---- B7 设备（第 12、13、14 行）----
  'devices:read': ALL,
  'device-logs:read': ALL,
  'devices:transition': ALL,
  'devices:oee:read': ADMIN_MANAGER,

  // ---- B8 经营驾驶舱与月报（第 15 行）----
  'dashboards:read': ADMIN_MANAGER,
  'monthly-reports:create': ADMIN_MANAGER,

  // ---- B10 预警中心（第 16 行）与 F4 根因（第 17 行，仅 admin）----
  'alerts:read': ADMIN_MANAGER,
  'alerts:transition': ADMIN_MANAGER,
  'alerts:root-cause:create': ADMIN_ONLY,

  // ---- F3 智能问数 / F2 日报（第 18、19 行）----
  'data-queries:create': ADMIN_MANAGER,
  'daily-reports:create': ADMIN_ONLY,

  // ---- F1 RAG 知识问答（第 20 行）----
  'rag-answers:create': ALL,
  'knowledge-sources:read': ALL,

  // ---- B11 SPC / B12 MRP-lite（第 21、22 行）----
  'quality-analyses:read': ADMIN_MANAGER,
  'material-requirement-calculations:create': ADMIN_MANAGER,

  // ---- B9 用户与权限、审计日志（第 23 行）----
  'users:read': ADMIN_ONLY,
  'users:write': ADMIN_ONLY,
  'role-permissions:read': ADMIN_ONLY,
  'audit-logs:read': ADMIN_ONLY,
  'ai-query-logs:read': ADMIN_ONLY,

  // ---- B14 开放 API：本版「未启用」，任何角色都不可访问（第 24 行）----
  'integrations:erp-orders:create': NONE,
  'integrations:device-events:create': NONE,
} as const satisfies Readonly<Record<string, readonly Role[]>>;

export type PermissionKey = keyof typeof PERMISSION_MATRIX;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_MATRIX) as PermissionKey[];

/** 某角色拥有的全部权限 key */
export function permissionsOf(role: Role): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) => PERMISSION_MATRIX[key].includes(role));
}
