/**
 * B11 SPC 质量分析服务（契约 §6.5）。只读；三角色中仅 admin / manager 可用，
 * operator 调用由服务端 403 拒绝（前端入口显隐只是体验优化）。
 */

import { httpGet } from './http'
import { compactParams } from './params'

import type {
  GoodRateResponse,
  ParetoResponse,
  QualityAnalysisQuery,
  TrendResponse,
} from '@/types/quality-analysis'

export const qualityAnalysesService = {
  /** GET /api/v1/quality-analyses/paretos —— 不良品 Pareto（defect.qty） */
  paretos(query: QualityAnalysisQuery, signal?: AbortSignal): Promise<ParetoResponse> {
    return httpGet<ParetoResponse>('/quality-analyses/paretos', compactParams({ ...query }), {
      signal,
    })
  },

  /** GET /api/v1/quality-analyses/trends —— 报工不良率趋势（reportBadRate） */
  trends(query: QualityAnalysisQuery, signal?: AbortSignal): Promise<TrendResponse> {
    return httpGet<TrendResponse>('/quality-analyses/trends', compactParams({ ...query }), {
      signal,
    })
  },

  /** GET /api/v1/quality-analyses/good-rates —— 报工良品率（isTrueFpy 恒 false） */
  goodRates(query: QualityAnalysisQuery, signal?: AbortSignal): Promise<GoodRateResponse> {
    return httpGet<GoodRateResponse>('/quality-analyses/good-rates', compactParams({ ...query }), {
      signal,
    })
  },
}
