import { httpPost } from './http'

export interface DailyReportOverview {
  planQty: number
  planTotalQty: number
  doneQty: number
  outputQty: number
  goodQty: number
  badQty: number
  completionRate: number | null
  goodRate: number | null
  isTrueFpy: boolean
  text: string
}

export interface DailyReportLinePerformance {
  prodLine: string
  planQty: number
  planTotalQty: number
  doneQty: number
  outputQty: number
  goodQty: number
  badQty: number
  completionRate: number | null
  goodRate: number | null
}

export interface DailyReportCauseItem {
  text: string
  evidenceRefs: string[]
}

export interface DailyReportAlertItem {
  alertId: string
  type: string
  title: string
  possibleCauses: DailyReportCauseItem[]
  explanation: string | null
  suggestion: string | null
  analysisStatus: string
}

export interface DailyReportSuggestionItem {
  alertId: string
  text: string
}

export interface DailyReportResponse {
  date: string
  answerStatus: 'answered' | 'no_data'
  overview: DailyReportOverview
  linePerformance: DailyReportLinePerformance[]
  alerts: DailyReportAlertItem[]
  suggestions: DailyReportSuggestionItem[]
  mode: string
  degraded: boolean
  snapshotAt: string
  dataSource: string
  dataLabel: string
}

export interface GenerateDailyReportPayload {
  date: string
}

export const DailyReportsService = {
  /**
   * 生成生产日报（POST /api/v1/daily-reports，仅 admin 可用）
   */
  generate(payload: GenerateDailyReportPayload, signal?: AbortSignal): Promise<DailyReportResponse> {
    return httpPost<DailyReportResponse>('/daily-reports', payload, { signal })
  },
}
