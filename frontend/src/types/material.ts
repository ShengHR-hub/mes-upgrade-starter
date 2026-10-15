/**
 * B5/B6 物料与追溯类型（契约 §6.6）。
 *
 * 边界声明：
 * - `Bom.qty` 是**精确十进制字符串**（如 `"2.00"`），展示与输入都按字符串处理，
 *  不用 number 计算（契约 §2.1）；
 * - `MaterialBatch.qty` 仅表示**入库数量**，不是可用库存；
 * - `SnTrace` 是单快照：一个 SN 仅有一个当前快照及一个批次。
 */

import type { DataSourceMeta } from './api'

/** 物料主数据（企业来源 enterprise-master） */
export interface Material extends DataSourceMeta {
  code: string
  name: string
  spec: string | null
  category: string | null
  unit: string | null
  safetyStock: number
  supplier: string | null
  remark: string | null
}

export interface MaterialListQuery {
  page?: number
  pageSize?: number
  keyword?: string
  category?: string
}

/** 产品 BOM 行 */
export interface Bom extends DataSourceMeta {
  id: string
  productCode: string
  level: number
  materialCode: string
  /** 精确十进制字符串，如 "2.00" */
  qty: string
  unit: string | null
}

export interface BomListQuery {
  page?: number
  pageSize?: number
}

export interface CreateBomPayload {
  materialCode: string
  level: number
  /** 十进制字符串，> 0 */
  qty: string
  unit?: string
}

export interface UpdateBomPayload {
  level?: number
  qty?: string
  /** null 表示清空单位 */
  unit?: string | null
}

/** 物料批次（演示数据） */
export interface MaterialBatch extends DataSourceMeta {
  id: string
  batchNo: string
  materialCode: string
  /** 仅入库数量，不是可用库存 */
  qty: number
  inboundAt: string | null
  supplier: string | null
}

export interface MaterialBatchListQuery {
  page?: number
  pageSize?: number
  materialCode?: string
  batchNo?: string
  inboundDateFrom?: string
  inboundDateTo?: string
}

export interface CreateMaterialBatchPayload {
  batchNo: string
  materialCode: string
  qty: number
  inboundAt: string
  supplier?: string
}

/** SN 追溯快照（演示数据） */
export interface SnTrace extends DataSourceMeta {
  id: string
  sn: string
  workOrderId: string
  productCode: string
  taskId: string | null
  operatorId: string | null
  deviceCode: string | null
  batchId: string | null
  qcResult: 'OK' | 'NG' | null
  producedAt: string | null
}

export interface SnTraceListQuery {
  page?: number
  pageSize?: number
  sn?: string
  workOrderId?: string
  batchId?: string
}

export interface CreateSnTracePayload {
  sn: string
  workOrderId: string
  taskId?: string
  deviceCode?: string
  batchId?: string
  qcResult?: 'OK' | 'NG'
}

export interface UpdateSnTracePayload {
  taskId?: string
  deviceCode?: string
  batchId?: string
  qcResult?: 'OK' | 'NG'
}

/** SN 详情：单快照 + 工单级关联上下文（仅作参考，不是逐工序已证实历史） */
export interface SnTraceDetail {
  trace: SnTrace
  context: {
    tasks: Array<Record<string, unknown>>
    inspections: Array<Record<string, unknown>>
  }
  coverage: string
  limitations: string[]
}

export interface SnTraceExportResult {
  fileName: string
  mediaType: string
  content: string
  coverage: string
  limitations?: string[]
}
