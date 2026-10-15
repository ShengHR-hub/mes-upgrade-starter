import { httpGet } from './http'
import { compactParams } from './params'

export interface LineProductionMetrics {
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

export interface SummaryProductionMetrics {
  planQty: number
  planTotalQty: number
  doneQty: number
  outputQty: number
  goodQty: number
  badQty: number
  completionRate: number | null
  goodRate: number | null
  isTrueFpy: boolean
  calculationStatus: 'available' | 'no_data' | 'insufficient_data'
  missingInputs?: string[]
}

export interface DashboardProductionMetricsResponse {
  startDate: string
  endDate: string
  snapshotAt: string
  metrics: SummaryProductionMetrics
  lines: LineProductionMetrics[]
  dataSource?: string
  dataLabel?: string
}

export interface DashboardQualityMetricsResponse {
  goodQty: number
  badQty: number
  goodRate: number | null
  isTrueFpy: boolean
  snapshotAt: string
  dataSource?: string
  dataLabel?: string
}

export interface DashboardDeviceMetricsResponse {
  counts: {
    运行中: number
    待机: number
    维修中: number
    停机: number
  }
  oee: null
  calculationStatus: 'insufficient_data'
  missingInputs: string[]
  snapshotAt: string
  dataSource?: string
  dataLabel?: string
}

export interface DashboardDeliveryMetricsResponse {
  orderCount: number
  completedOrderCount: number
  delayedOrderCount: number
  calculationStatus: 'available' | 'no_data'
  snapshotAt: string
  dataSource?: string
  dataLabel?: string
}

export interface ProductionMetricsQuery {
  startDate: string
  endDate: string
  prodLine?: string
  workshop?: string
  productCode?: string
}

export interface QualityMetricsQuery {
  startDate: string
  endDate: string
  prodLine?: string
  workshop?: string
  productCode?: string
}

export interface DeviceMetricsQuery {
  workshop?: string
  prodLine?: string
}

export interface DeliveryMetricsQuery {
  startDate: string
  endDate: string
  productCode?: string
}

export const DashboardsService = {
  getProductionMetrics(
    query: ProductionMetricsQuery,
    signal?: AbortSignal,
  ): Promise<DashboardProductionMetricsResponse> {
    return httpGet<DashboardProductionMetricsResponse>(
      '/dashboards/production-metrics',
      compactParams({ ...query }),
      { signal },
    )
  },

  getQualityMetrics(
    query: QualityMetricsQuery,
    signal?: AbortSignal,
  ): Promise<DashboardQualityMetricsResponse> {
    return httpGet<DashboardQualityMetricsResponse>(
      '/dashboards/quality-metrics',
      compactParams({ ...query }),
      { signal },
    )
  },

  getDeviceMetrics(
    query?: DeviceMetricsQuery,
    signal?: AbortSignal,
  ): Promise<DashboardDeviceMetricsResponse> {
    return httpGet<DashboardDeviceMetricsResponse>(
      '/dashboards/device-metrics',
      query ? compactParams({ ...query }) : undefined,
      { signal },
    )
  },

  getDeliveryMetrics(
    query: DeliveryMetricsQuery,
    signal?: AbortSignal,
  ): Promise<DashboardDeliveryMetricsResponse> {
    return httpGet<DashboardDeliveryMetricsResponse>(
      '/dashboards/delivery-metrics',
      compactParams({ ...query }),
      { signal },
    )
  },
}
