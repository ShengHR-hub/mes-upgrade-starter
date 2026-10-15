import { httpGet, httpPost } from './http'
import type { PageResult } from '@/types/api'
import { compactParams } from './params'

export interface Defect {
  id: string
  qcRecordId?: string
  defectType: string
  qty: number
  stepName?: string | null
  description?: string | null
  createdAt?: string
  dataSource?: string
  dataLabel?: string
}

export interface QualityInspection {
  id: string
  workOrderId: string
  taskId?: string | null
  result: 'OK' | 'NG'
  checkQty: number
  ngQty: number
  inspectorId?: string | null
  checkedAt: string
  remark?: string | null
  defects?: Defect[]
  dataSource?: string
  dataLabel?: string
}

export interface ListQualityInspectionsQuery {
  page?: number
  pageSize?: number
  workOrderId?: string
  taskId?: string
  result?: 'OK' | 'NG'
  startDate?: string
  endDate?: string
  prodLine?: string
  workshop?: string
  productCode?: string
}

export interface ListDefectsQuery {
  page?: number
  pageSize?: number
  qcRecordId?: string
  workOrderId?: string
  defectType?: string
  startDate?: string
  endDate?: string
}

export interface CreateDefectItemDto {
  defectType: string
  qty: number
  description?: string
}

export interface CreateQualityInspectionDto {
  workOrderId: string
  taskId?: string
  result: 'OK' | 'NG'
  checkQty: number
  ngQty: number
  remark?: string
  defects?: CreateDefectItemDto[]
}

export const QualityInspectionsService = {
  list(query: ListQualityInspectionsQuery, signal?: AbortSignal): Promise<PageResult<QualityInspection>> {
    return httpGet<PageResult<QualityInspection>>(
      '/quality-inspections',
      compactParams({ ...query }),
      { signal },
    )
  },
  findOne(id: string, signal?: AbortSignal): Promise<QualityInspection> {
    return httpGet<QualityInspection>(
      `/quality-inspections/${encodeURIComponent(id)}`,
      undefined,
      { signal },
    )
  },
  create(dto: CreateQualityInspectionDto, signal?: AbortSignal): Promise<QualityInspection> {
    return httpPost<QualityInspection>('/quality-inspections', dto, { signal })
  },
  listDefects(query: ListDefectsQuery, signal?: AbortSignal): Promise<PageResult<Defect>> {
    return httpGet<PageResult<Defect>>('/defects', compactParams({ ...query }), { signal })
  },
}
