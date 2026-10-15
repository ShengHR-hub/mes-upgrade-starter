import { httpPost } from './http'

/**
 * F3 智能问数服务 —— 契约 §7.1。
 *
 * 约定：
 * - 只调用 NestJS 公开接口 `POST /api/v1/data-queries`（admin / manager）；
 * - 数字由后端受控查询提供，本服务不做任何指标计算；
 * - 支持 AbortSignal 取消（useAsyncTask 轮次隔离依赖它）。
 */

export type QueryAnswerStatus = 'answered' | 'no_data' | 'clarification_required'

export interface QueryColumn {
  key: string
  label: string
  type?: string
  unit?: string
}

export interface QuerySource {
  resource: string
  filters?: Record<string, unknown>
}

export interface QuerySpec {
  metric: string
  groupBy: string
  operation: string
  startDate: string
  endDate: string
  prodLine: string | null
}

export interface QueryAnswerResponse {
  answerStatus: QueryAnswerStatus
  answer: string
  clarification: string | null
  query: QuerySpec | null
  columns: QueryColumn[]
  rows: Array<Record<string, unknown>>
  sources: QuerySource[]
  mode: string
  degraded: boolean
  snapshotAt: string
  dataSource: string
  dataLabel: string
}

export interface DataQueryPayload {
  question: string
  startDate?: string
  endDate?: string
  prodLine?: string
}

export const DataQueriesService = {
  /**
   * 发起智能问数（POST /api/v1/data-queries）
   */
  query(payload: DataQueryPayload, signal?: AbortSignal): Promise<QueryAnswerResponse> {
    return httpPost<QueryAnswerResponse>('/data-queries', payload, { signal })
  },
}
