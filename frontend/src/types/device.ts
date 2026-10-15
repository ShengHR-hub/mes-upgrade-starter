/**
 * B7 设备类型（契约 §6.7）。
 *
 * - `Device.dataSource = enterprise-master`，但当前状态与演示固定约束属演示口径
 *   （`statusDataSource: demo`）；
 * - OEE 缺输入时返回 null + `insufficient_data` + `missingInputs`，
 *   前端必须展示缺失项，**不得把 null 显示成 0**。
 */

import type { DataSourceMeta } from './api'

export type DeviceStatus = '运行中' | '待机' | '维修中' | '停机'

export const DEVICE_STATUSES: readonly DeviceStatus[] = ['运行中', '待机', '维修中', '停机']

export interface Device extends DataSourceMeta {
  code: string
  name: string
  workshop: string
  prodLine: string | null
  status: string
  purchaseYear: number | null
  supplier: string | null
  remark: string | null
  updatedAt: string | null
  statusDataSource: string
}

export interface DeviceListQuery {
  page?: number
  pageSize?: number
  workshop?: string
  prodLine?: string
  status?: string
  keyword?: string
}

export interface DeviceStateLog extends DataSourceMeta {
  id: string
  deviceCode: string
  oldStatus: string | null
  newStatus: string
  changedBy: string | null
  remark: string | null
  changedAt: string | null
}

export interface DeviceStateLogListQuery {
  page?: number
  pageSize?: number
  startDate?: string
  endDate?: string
}

export interface DeviceOee {
  deviceCode: string
  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null
  calculationStatus: 'insufficient_data' | 'available'
  missingInputs: string[]
}
