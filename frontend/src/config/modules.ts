/**
 * 模块配置 —— **单一配置源**（S4 要求第 3 条）。
 *
 * 路由、菜单、面包屑、页面标题、权限元数据全部从本文件派生：
 * - `router/routes.ts` 用它生成路由（命名 + 懒加载 + meta）
 * - `layouts/AppLayout.vue` 用它生成分组菜单与面包屑
 * - `router/guard.ts` 用它生成的 meta.roles 做访问控制
 *
 * 模块编号与命名已与 `docs/需求规格说明书_定稿.md` §三/§四 及
 * `docs/api-contract.md` §5.2 逐项核对。
 */

import { rolesForPermission, type PermissionKey } from './permissions'
import type { Role } from '@/types/role'

/** 菜单/模块图标名（映射见 components/AppIcon.vue，只引入实际用到的图标） */
export const ICON_NAMES = [
  'home',
  'order',
  'work-order',
  'report',
  'inspection',
  'dashboard',
  'alert',
  'spc',
  'daily-report',
  'data-query',
  'knowledge',
  'material',
  'trace',
  'mrp',
  'device',
  'user',
  'log',
] as const

export type IconName = (typeof ICON_NAMES)[number]

export const MODULE_GROUP_KEYS = [
  'overview',
  'production',
  'analysis',
  'ai',
  'material',
  'equipment',
  'system',
] as const

export type ModuleGroupKey = (typeof MODULE_GROUP_KEYS)[number]

export interface ModuleGroup {
  key: ModuleGroupKey
  title: string
  icon: IconName
}

/** 菜单分组（按展示顺序） */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
  { key: 'overview', title: '概览', icon: 'home' },
  { key: 'production', title: '生产执行', icon: 'work-order' },
  { key: 'analysis', title: '经营与质量分析', icon: 'dashboard' },
  { key: 'ai', title: 'AI 能力', icon: 'knowledge' },
  { key: 'material', title: '物料与追溯', icon: 'material' },
  { key: 'equipment', title: '设备', icon: 'device' },
  { key: 'system', title: '系统管理', icon: 'user' },
]

export interface ModuleDefinition {
  /** 唯一 key，同时作为路由 name */
  key: string
  /** 路由路径（绝对路径；作为子路由时会去掉前导 `/`） */
  path: string
  /** 页面标题 / 菜单标题 / 面包屑末项（三处共用同一字符串，保证一致） */
  title: string
  /** 所属菜单分组 */
  group: ModuleGroupKey
  /** 模块图标 */
  icon: IconName
  /** 模块编号（B1～B14 / F1～F4） */
  code: string
  /** 一句话说明（来自需求规格说明书） */
  summary: string
  /** 访问本页所需的「读」权限；页面可见角色由此推导 */
  readPermission: PermissionKey
  /** 覆盖页面的可见角色（默认由 readPermission 推导，仅特殊情形使用） */
  pageRoles?: readonly Role[]
  /** 后续会话将使用的契约接口路径（仅展示，不代表已实现） */
  plannedApis: readonly string[]
  /** 是否已实现；S4 全部为 false（占位页） */
  implemented: boolean
  /** 真实页面组件；为 undefined 时路由使用通用占位页 */
  component?: () => Promise<unknown>
}

export const MODULES: readonly ModuleDefinition[] = [
  {
    key: 'home',
    path: '/',
    title: '首页',
    group: 'overview',
    icon: 'home',
    code: '导航',
    summary: '模块导航与服务健康状态。不展示任何业务指标。',
    readPermission: 'users:me:read',
    plannedApis: ['GET /api/v1/health'],
    implemented: true,
    // 已实现的页面在此登记真实组件；未实现的保持 undefined，由路由使用通用占位页
    component: () => import('@/views/HomeView.vue'),
  },
  {
    key: 'orders',
    path: '/orders',
    title: '生产订单',
    group: 'production',
    icon: 'order',
    code: 'B1',
    summary: '创建 / 确认生产订单，确认后自动生成唯一一张工单。',
    readPermission: 'orders:read',
    plannedApis: [
      'GET /api/v1/orders',
      'POST /api/v1/orders',
      'GET /api/v1/orders/{id}',
      'PATCH /api/v1/orders/{id}',
      'POST /api/v1/orders/{id}/confirmations',
    ],
    implemented: true,
    component: () => import('@/views/orders/OrdersView.vue'),
  },
  {
    key: 'work-orders',
    path: '/work-orders',
    title: '工单与工序任务',
    group: 'production',
    icon: 'work-order',
    code: 'B2',
    summary: '工单按工艺路线自动分解为工序任务；状态机 待启动 → 在产 → 完工。',
    readPermission: 'work-orders:read',
    plannedApis: [
      'GET /api/v1/work-orders',
      'GET /api/v1/work-orders/{id}',
      'PATCH /api/v1/work-orders/{id}',
      'GET /api/v1/work-orders/{id}/tasks',
      'GET /api/v1/tasks/{id}',
      'PATCH /api/v1/tasks/{id}',
      'POST /api/v1/work-orders/{id}/state-transitions',
      'POST /api/v1/tasks/{id}/state-transitions',
    ],
    implemented: true,
    component: () => import('@/views/work-orders/WorkOrdersView.vue'),
  },
  {
    key: 'reports',
    path: '/reports',
    title: '工序报工',
    group: 'production',
    icon: 'report',
    code: 'B3',
    summary: '工位扫码三步报工（扫工单 → 输数量 → 确认），实时累计末道工序完工数。',
    readPermission: 'reports:read',
    plannedApis: ['GET /api/v1/reports', 'POST /api/v1/reports'],
    implemented: true,
    component: () => import('@/views/reports/ReportsView.vue'),
  },
  {
    key: 'quality-inspections',
    path: '/quality-inspections',
    title: '质量检验',
    group: 'production',
    icon: 'inspection',
    code: 'B4',
    summary: '检验结果 OK / NG 录入；NG 自动创建不良品记录。',
    readPermission: 'quality-inspections:read',
    plannedApis: [
      'GET /api/v1/quality-inspections',
      'GET /api/v1/quality-inspections/{id}',
      'POST /api/v1/quality-inspections',
      'GET /api/v1/defects',
    ],
    implemented: true,
    component: () => import('@/views/quality-inspections/QualityInspectionsView.vue'),
  },
  {
    key: 'dashboard',
    path: '/dashboard',
    title: '经营驾驶舱',
    group: 'analysis',
    icon: 'dashboard',
    code: 'B8',
    summary: '产量 / 质量 / 设备 / 交付多维看板；数字与报工汇总同源。',
    readPermission: 'dashboards:read',
    plannedApis: [
      'GET /api/v1/dashboards/production-metrics',
      'GET /api/v1/dashboards/quality-metrics',
      'GET /api/v1/dashboards/device-metrics',
      'GET /api/v1/dashboards/delivery-metrics',
      'POST /api/v1/monthly-reports',
    ],
    implemented: true,
    component: () => import('@/views/dashboard/DashboardView.vue'),
  },
  {
    key: 'alerts',
    path: '/alerts',
    title: '预警中心',
    group: 'analysis',
    icon: 'alert',
    code: 'B10',
    summary: '质量 / 交付 / 设备预警统一归集、分级处理；根因分析（F4）仅管理员可用。',
    readPermission: 'alerts:read',
    plannedApis: [
      'GET /api/v1/alerts',
      'GET /api/v1/alerts/{id}',
      'POST /api/v1/alerts/{id}/state-transitions',
      'POST /api/v1/alerts/{id}/root-cause-analyses',
    ],
    implemented: true,
    component: () => import('@/views/alerts/AlertsView.vue'),
  },
  {
    key: 'quality-analyses',
    path: '/quality-analyses',
    title: 'SPC 质量分析',
    group: 'analysis',
    icon: 'spc',
    code: 'B11',
    summary:
      '不良 Pareto、工序报工不良率趋势、报工良品率（isTrueFpy 恒 false，不等同于真实 FPY）。',
    readPermission: 'quality-analyses:read',
    plannedApis: [
      'GET /api/v1/quality-analyses/paretos',
      'GET /api/v1/quality-analyses/trends',
      'GET /api/v1/quality-analyses/good-rates',
    ],
    implemented: true,
    component: () => import('@/views/quality-analyses/QualityAnalysesView.vue'),
  },
  {
    key: 'ai-daily-report',
    path: '/ai/daily-report',
    title: 'AI 日报',
    group: 'ai',
    icon: 'daily-report',
    code: 'F2',
    summary: '按日生成四段式生产日报（总览 / 产线表现 / 预警 / 建议），全部标注演示数据。',
    readPermission: 'daily-reports:create',
    plannedApis: ['POST /api/v1/daily-reports'],
    implemented: true,
    component: () => import('@/views/daily-report/DailyReportView.vue'),
  },
  {
    key: 'ai-data-query',
    path: '/ai/data-query',
    title: '智能问数',
    group: 'ai',
    icon: 'data-query',
    code: 'F3',
    summary: '自然语言查询生产数据，支持单日与近 7 天趋势；数字与演示数据一致。',
    readPermission: 'data-queries:create',
    plannedApis: ['POST /api/v1/data-queries'],
    implemented: true,
    component: () => import('@/views/data-query/DataQueryView.vue'),
  },
  {
    key: 'ai-knowledge',
    path: '/ai/knowledge',
    title: '企业知识问答',
    group: 'ai',
    icon: 'knowledge',
    code: 'F1',
    summary: 'RAG 工艺知识问答，回答带引用来源；资料中没有的信息明确拒答。',
    readPermission: 'rag-answers:create',
    plannedApis: ['POST /api/v1/rag-answers', 'GET /api/v1/knowledge-sources'],
    implemented: true,
    component: () => import('@/views/ai-knowledge/AiKnowledgeView.vue'),
  },
  {
    key: 'materials',
    path: '/materials',
    title: '物料管理',
    group: 'material',
    icon: 'material',
    code: 'B5',
    summary:
      '产品 / 物料 / BOM / 批次入库。BOM qty 为精确十进制字符串；批次数量仅表示入库数量，不等于可用库存。',
    readPermission: 'materials:read',
    plannedApis: [
      'GET /api/v1/products',
      'GET /api/v1/products/{code}/process-routes',
      'GET /api/v1/products/{code}/boms',
      'POST /api/v1/products/{code}/boms',
      'PATCH /api/v1/boms/{id}',
      'DELETE /api/v1/boms/{id}',
      'GET /api/v1/materials',
      'PATCH /api/v1/materials/{code}',
      'GET /api/v1/material-batches',
      'POST /api/v1/material-batches',
      'GET /api/v1/material-batches/{id}/sn-traces',
    ],
    implemented: true,
    component: () => import('@/views/materials/MaterialsView.vue'),
  },
  {
    key: 'sn-traces',
    path: '/sn-traces',
    title: 'SN 追溯',
    group: 'material',
    icon: 'trace',
    code: 'B6',
    summary:
      '按 SN 精确查询工单级单快照追溯与 JSON 导出；明确标注覆盖率与限制，不宣称满足 IATF 16949。',
    readPermission: 'sn-traces:read',
    plannedApis: [
      'GET /api/v1/sn-traces',
      'GET /api/v1/sn-traces/{sn}',
      'POST /api/v1/sn-traces',
      'PATCH /api/v1/sn-traces/{sn}',
      'POST /api/v1/sn-traces/{sn}/exports',
      'GET /api/v1/material-batches/{id}/sn-traces',
    ],
    implemented: true,
    component: () => import('@/views/sn-traces/SnTracesView.vue'),
  },
  {
    key: 'mrp',
    path: '/mrp',
    title: 'MRP-lite',
    group: 'material',
    icon: 'mrp',
    code: 'B12',
    summary:
      '按订单 + BOM 计算毛需求；无出库流水，净缺口与采购量不可用（服务端恒为 null）。',
    readPermission: 'material-requirement-calculations:create',
    plannedApis: ['POST /api/v1/material-requirement-calculations'],
    implemented: true,
    component: () => import('@/views/mrp/MrpView.vue'),
  },
  {
    key: 'devices',
    path: '/devices',
    title: '设备管理',
    group: 'equipment',
    icon: 'device',
    code: 'B7',
    summary:
      '设备台账、状态日志与 OEE 查询。OEE 缺关键输入时展示缺失项说明，不用默认值编造；状态变更入口在 Q3 批准前保持关闭。',
    readPermission: 'devices:read',
    plannedApis: [
      'GET /api/v1/devices',
      'GET /api/v1/devices/{code}',
      'POST /api/v1/devices/{code}/state-transitions',
      'GET /api/v1/devices/{code}/state-logs',
      'GET /api/v1/devices/{code}/oee-analyses',
    ],
    implemented: true,
    component: () => import('@/views/devices/DevicesView.vue'),
  },
  {
    key: 'users',
    path: '/users',
    title: '用户与权限',
    group: 'system',
    icon: 'user',
    code: 'B9',
    summary:
      '账号管理与三角色权限清单（仅管理员）。密码哈希使用 Argon2id；最后一个启用管理员受并发保护，不可停用或降级。',
    readPermission: 'users:read',
    plannedApis: [
      'GET /api/v1/users',
      'POST /api/v1/users',
      'PATCH /api/v1/users/{id}',
      'GET /api/v1/role-permissions',
      'POST /api/v1/users/me/password-changes',
    ],
    implemented: true,
    component: () => import('@/views/users/UsersView.vue'),
  },
  {
    key: 'logs',
    path: '/logs',
    title: '审计 / AI 查询日志',
    group: 'system',
    icon: 'log',
    code: 'B9',
    summary: '操作审计日志与 AI 查询日志（仅管理员，只读，不提供任何修改或删除入口）。',
    readPermission: 'audit-logs:read',
    plannedApis: ['GET /api/v1/audit-logs', 'GET /api/v1/ai-query-logs'],
    implemented: true,
    component: () => import('@/views/logs/LogsView.vue'),
  },
]

/** 页面可见角色：优先取显式覆盖，否则由读权限推导（契约 §5.2） */
export function pageRolesOf(module: ModuleDefinition): readonly Role[] {
  return module.pageRoles ?? rolesForPermission(module.readPermission)
}

export function findModuleByKey(key: string | undefined): ModuleDefinition | undefined {
  if (!key) return undefined
  return MODULES.find((module) => module.key === key)
}

export function findModuleByPath(path: string): ModuleDefinition | undefined {
  return MODULES.find((module) => module.path === path)
}

export function findGroupByKey(key: string | undefined): ModuleGroup | undefined {
  if (!key) return undefined
  return MODULE_GROUPS.find((group) => group.key === key)
}

export interface GroupedModules {
  group: ModuleGroup
  modules: ModuleDefinition[]
}

/**
 * 按分组组织模块；`role` 为 null（未登录 / 骨架预览）时返回全部模块，
 * 由调用方决定如何标注「未校验权限」。
 */
export function groupedModules(role: Role | null): GroupedModules[] {
  return MODULE_GROUPS.map((group) => ({
    group,
    modules: MODULES.filter(
      (module) => module.group === group.key && (role === null || pageRolesOf(module).includes(role)),
    ),
  })).filter((entry) => entry.modules.length > 0)
}
