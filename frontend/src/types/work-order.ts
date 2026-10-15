/**
 * B2 工单与工序任务类型 —— 契约 §6.1（WorkOrder / Task）/ §6.3。
 */

import type { DataSourceMeta, Id, PaginationQuery } from './api'

export const WORK_ORDER_STATUS = {
  PENDING: '待启动',
  IN_PRODUCTION: '在产',
  PAUSED: '暂停',
  COMPLETED: '完工',
  CLOSED: '关闭',
} as const

export const WORK_ORDER_STATUS_VALUES = [
  WORK_ORDER_STATUS.PENDING,
  WORK_ORDER_STATUS.IN_PRODUCTION,
  WORK_ORDER_STATUS.PAUSED,
  WORK_ORDER_STATUS.COMPLETED,
  WORK_ORDER_STATUS.CLOSED,
] as const

export const TASK_STATUS = {
  PENDING: '待启动',
  IN_PRODUCTION: '在产',
  COMPLETED: '完工',
} as const

export const TASK_STATUS_VALUES = [
  TASK_STATUS.PENDING,
  TASK_STATUS.IN_PRODUCTION,
  TASK_STATUS.COMPLETED,
] as const

export const WORK_ORDER_STATUS_TAG: Readonly<
  Record<string, 'primary' | 'success' | 'info' | 'warning' | 'danger'>
> = {
  [WORK_ORDER_STATUS.PENDING]: 'info',
  [WORK_ORDER_STATUS.IN_PRODUCTION]: 'warning',
  [WORK_ORDER_STATUS.COMPLETED]: 'success',
  [WORK_ORDER_STATUS.PAUSED]: 'danger',
  [WORK_ORDER_STATUS.CLOSED]: 'info',
}

export const TASK_STATUS_TAG: Readonly<
  Record<string, 'primary' | 'success' | 'info' | 'warning' | 'danger'>
> = {
  [TASK_STATUS.PENDING]: 'info',
  [TASK_STATUS.IN_PRODUCTION]: 'warning',
  [TASK_STATUS.COMPLETED]: 'success',
}

/**
 * 本版已批准的状态流转（需求主线）。UI 只渲染这些按钮；
 * 暂停 / 恢复 / 关闭属 Q2 未决，**不提供任何可执行入口**。
 */
export const WORK_ORDER_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  [WORK_ORDER_STATUS.PENDING]: [WORK_ORDER_STATUS.IN_PRODUCTION],
  [WORK_ORDER_STATUS.IN_PRODUCTION]: [WORK_ORDER_STATUS.COMPLETED],
}

/**
 * ⚠️ 任务状态迁移表：**Q2 未获批准前没有任何界面入口**（后端返回 30006）。
 * 保留定义仅为完整映射契约 §6.3；`WorkOrdersView.vue` 不引用本常量。
 */
export const TASK_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  [TASK_STATUS.PENDING]: [TASK_STATUS.IN_PRODUCTION],
  [TASK_STATUS.IN_PRODUCTION]: [TASK_STATUS.COMPLETED],
}

export interface WorkOrder extends DataSourceMeta {
  id: Id
  code: string
  saleOrderId: Id | null
  productCode: string
  qty: number
  doneQty: number
  status: string
  planStart: string | null
  planEnd: string | null
  createdBy: Id | null
  createdAt: string | null
}

export interface Task extends DataSourceMeta {
  id: Id
  workOrderId: Id
  seq: number
  stepName: string
  workshop: string | null
  prodLine: string | null
  deviceCode: string | null
  operatorId: Id | null
  planQty: number
  goodQty: number
  badQty: number
  status: string
  planStart: string | null
  planEnd: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface WorkOrderListQuery extends PaginationQuery {
  saleOrderId?: string
  productCode?: string
  status?: string
  keyword?: string
  prodLine?: string
  workshop?: string
}

export interface TaskListQuery extends PaginationQuery {
  status?: string
}

/** PATCH /work-orders/{id}：`null` = 清空计划，未传 = 保持原值 */
export interface UpdateWorkOrderPayload {
  planStart?: string | null
  planEnd?: string | null
}

/**
 * PATCH /tasks/{id}：`null` = 清空，未传 = 保持原值。
 *
 * ⚠️ 分配字段（deviceCode / operatorId）的条件待 Q2，界面**不提供**对应入口。
 */
export interface UpdateTaskPayload {
  deviceCode?: string | null
  operatorId?: string | null
  prodLine?: string | null
  planStart?: string | null
  planEnd?: string | null
}

export interface StateTransitionPayload {
  expectedStatus: string
  targetStatus: string
}

export interface WorkOrderTransitionResult extends DataSourceMeta {
  id: Id
  status: string
}

export interface TaskTransitionResult extends DataSourceMeta {
  id: Id
  status: string
  startedAt: string | null
  finishedAt: string | null
}
