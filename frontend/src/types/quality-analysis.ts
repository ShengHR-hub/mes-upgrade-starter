/**
 * B11 SPC 质量分析类型（契约 §6.5）。
 *
 * 诚实性口径：
 * - Pareto：`defect.qty` 聚合，`share` / `cumulativeShare` 为百分比数值（96 = 96%）；
 * - 趋势：`reportBadRate`（报工不良率），goodQty/badQty 均为**报工数量**，
 *   不把质检 ng_qty 重复计入；某日报工总量为 0 时 `badRate` 为 null；
 * - 良品率：`isTrueFpy` 恒为 false —— 报工良品率**不是**真实 FPY；
 * - 全部响应带 `dataSource:"demo"` / `dataLabel:"演示数据"` 与 `snapshotAt`。
 */

import type { DataSourceMeta } from './api'

export interface ParetoItem {
  defectType: string
  qty: number
  share: number
  cumulativeShare: number
}

export interface ParetoResponse extends DataSourceMeta {
  items: ParetoItem[]
  totalDefectQty: number
  calculationStatus: 'available' | 'no_data'
  snapshotAt: string | null
}

export interface TrendPoint {
  date: string
  goodQty: number
  badQty: number
  badRate: number | null
}

export interface TrendResponse extends DataSourceMeta {
  metric: 'reportBadRate'
  points: TrendPoint[]
  calculationStatus: 'available' | 'no_data'
  snapshotAt: string | null
}

export interface GoodRateResponse extends DataSourceMeta {
  metric: 'reportGoodRate'
  value: number | null
  isTrueFpy: false
  calculationStatus: 'available' | 'no_data'
  snapshotAt: string | null
}

/** SPC 查询参数（startDate / endDate 必填；prodLine、stepName 可选） */
export interface QualityAnalysisQuery {
  startDate: string
  endDate: string
  prodLine?: string
  stepName?: string
}
