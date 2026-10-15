import { httpGet, httpPost } from './http'
import type { PageResult } from '@/types/api'
import { compactParams } from './params'

export interface Report {
  id: string
  taskId: string
  userId: string
  goodQty: number
  badQty: number
  reportedAt: string
  dataSource?: string
  dataLabel?: string
}

export interface ListReportsQuery {
  page?: number
  pageSize?: number
  taskId?: string
  workOrderId?: string
  userId?: string
  startDate?: string
  endDate?: string
  prodLine?: string
  workshop?: string
  productCode?: string
}

export interface CreateReportDto {
  taskId: string
  goodQty: number
  badQty: number
}

export interface CreateReportResponse {
  report: Report
  taskTotals: { goodQty: number; badQty: number }
  workOrderTotals: { doneQty: number }
  dataSource?: string
  dataLabel?: string
}

export const ReportsService = {
  list(query: ListReportsQuery, signal?: AbortSignal): Promise<PageResult<Report>> {
    return httpGet<PageResult<Report>>('/reports', compactParams({ ...query }), { signal })
  },
  create(dto: CreateReportDto, signal?: AbortSignal): Promise<CreateReportResponse> {
    return httpPost<CreateReportResponse>('/reports', dto, { signal })
  },
}
