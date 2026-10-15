import { httpGet, httpPost } from './http'
import type { PageResult } from '@/types/api'
import { compactParams } from './params'

export interface Alert {
  id: string
  level: '紧急' | '重要' | '一般' | string
  type: string
  title: string
  content: string | null
  refType: string | null
  refId: string | null
  status: '未处理' | '已确认' | '已关闭' | string
  createdAt: string | null
  dataSource?: string
  dataLabel?: string
}

export interface ListAlertsQuery {
  page?: number
  pageSize?: number
  type?: string
  level?: string
  status?: string
  startDate?: string
  endDate?: string
}

export interface AlertStateTransitionPayload {
  expectedStatus: string
  targetStatus: string
}

export interface AlertStateTransitionResponse {
  id: string
  status: string
  dataSource?: string
  dataLabel?: string
}

export interface RootCauseCauseItem {
  text: string
  evidenceRefs: string[]
}

export interface RootCauseAnalysisResponse {
  alertId: string
  possibleCauses: RootCauseCauseItem[]
  suggestion: string | null
  analysisStatus: 'hypothesis' | 'insufficient_evidence' | 'no_anomaly' | string
  explanation: string | null
  mode: string
  degraded: boolean
  snapshotAt: string
  dataSource: string
  dataLabel: string
}

export const AlertsService = {
  list(query: ListAlertsQuery, signal?: AbortSignal): Promise<PageResult<Alert>> {
    return httpGet<PageResult<Alert>>('/alerts', compactParams({ ...query }), { signal })
  },

  getById(id: string, signal?: AbortSignal): Promise<Alert> {
    return httpGet<Alert>(`/alerts/${encodeURIComponent(id)}`, undefined, { signal })
  },

  transitionState(
    id: string,
    payload: AlertStateTransitionPayload,
    signal?: AbortSignal,
  ): Promise<AlertStateTransitionResponse> {
    return httpPost<AlertStateTransitionResponse>(
      `/alerts/${encodeURIComponent(id)}/state-transitions`,
      payload,
      { signal },
    )
  },

  /**
   * 预警根因分析（POST /api/v1/alerts/{id}/root-cause-analyses，仅 admin 可用）
   */
  analyzeRootCause(id: string, signal?: AbortSignal): Promise<RootCauseAnalysisResponse> {
    return httpPost<RootCauseAnalysisResponse>(
      `/alerts/${encodeURIComponent(id)}/root-cause-analyses`,
      undefined,
      { signal },
    )
  },
}
