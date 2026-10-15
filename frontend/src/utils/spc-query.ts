/**
 * B11 SPC 查询参数构造（纯函数，S11 复审 P2 修复）。
 *
 * 背景：`stepName` 只允许用于趋势接口（契约 §6.5 的 trends 查询参数）。
 * 此前三个接口共用同一参数对象，填写工序筛选后 Pareto / 良品率请求携带未知字段，
 * 被服务端 forbidNonWhitelisted 以 400/10001 拒绝（独立 HTTP 探针实证）。
 *
 * 本模块按接口分别构造参数：
 * - pareto / good-rates：`startDate`、`endDate`、`prodLine`；
 * - trends：上述 + `stepName`（仅在有值时携带）。
 */

import type { QualityAnalysisQuery } from '@/types/quality-analysis'

export interface SpcFilters {
  startDate: string
  endDate: string
  /** 「全部」表示不按产线过滤 */
  prodLine: string
  stepName: string
}

export interface SpcQueries {
  pareto: QualityAnalysisQuery
  trend: QualityAnalysisQuery
  goodRate: QualityAnalysisQuery
}

/** 日期与产线是三个接口的公共参数 */
function baseQuery(filters: SpcFilters): QualityAnalysisQuery {
  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    prodLine: filters.prodLine === '全部' ? undefined : filters.prodLine,
  }
}

export function buildSpcQueries(filters: SpcFilters): SpcQueries {
  const stepName = filters.stepName.trim();
  return {
    pareto: baseQuery(filters),
    // stepName 只进入趋势查询；无值时整键不出现
    trend: stepName ? { ...baseQuery(filters), stepName } : baseQuery(filters),
    goodRate: baseQuery(filters),
  };
}
