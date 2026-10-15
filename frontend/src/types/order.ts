/**
 * B1 生产订单类型 —— 契约 §6.1（Order）/ §6.2。
 *
 * 约定：
 * - BIGINT ID 用 `Id`（字符串），**禁止 Number()**；
 * - `dueDate` 是 DATE（`YYYY-MM-DD`），`createdAt` 是 RFC 3339（`+08:00`）；
 * - `status` 是**派生展示状态**（已完成 > 已延期 > 生产中 > 原值），筛选与展示同口径。
 */

import type { DataSourceMeta, Id, PaginationQuery } from './api'

export const ORDER_STATUS = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  IN_PRODUCTION: '生产中',
  COMPLETED: '已完成',
  DELAYED: '已延期',
} as const

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]

export const ORDER_STATUS_VALUES: readonly OrderStatus[] = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.DELAYED,
]

/** 状态标签配色（Element Plus tag type） */
export const ORDER_STATUS_TAG: Readonly<Record<string, 'primary' | 'success' | 'info' | 'warning' | 'danger'>> = {
  [ORDER_STATUS.PENDING]: 'info',
  [ORDER_STATUS.CONFIRMED]: 'primary',
  [ORDER_STATUS.IN_PRODUCTION]: 'warning',
  [ORDER_STATUS.COMPLETED]: 'success',
  [ORDER_STATUS.DELAYED]: 'danger',
}

/** 生命周期原值：只有处于该状态的订单才可编辑（契约 §6.2） */
export const ORDER_EDITABLE_BASE_STATUS = ORDER_STATUS.PENDING

export interface Order extends DataSourceMeta {
  id: Id
  code: string
  productCode: string
  qty: number
  dueDate: string
  status: string
  createdBy: Id | null
  createdAt: string | null
}

export interface OrderListQuery extends PaginationQuery {
  status?: string
  productCode?: string
  keyword?: string
  dueDateFrom?: string
  dueDateTo?: string
}

export interface CreateOrderPayload {
  code: string
  productCode: string
  qty: number
  dueDate: string
}

export interface UpdateOrderPayload {
  productCode?: string
  qty?: number
  dueDate?: string
}

export interface ConfirmationWorkOrderSummary {
  id: Id
  code: string
  taskCount: number
}

/** POST /orders/{id}/confirmations 成功响应 data（契约 §6.2） */
export interface OrderConfirmation extends DataSourceMeta {
  orderId: Id
  status: string
  workOrders: ConfirmationWorkOrderSummary[]
}
