/**
 * B6 SN 追溯服务（契约 §6.6）。
 *
 * - SN 精确查询（sn 参数是精确匹配，不用模糊结果冒充唯一追溯）；
 * - 详情与导出保留 coverage / limitations / 数据来源；
 * - 导出内容为 JSON 字符串，由前端下载为文件（业务 API 仍走统一包体）。
 */

import { httpGet, httpPatch, httpPost } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type {
  CreateSnTracePayload,
  SnTrace,
  SnTraceDetail,
  SnTraceExportResult,
  SnTraceListQuery,
  UpdateSnTracePayload,
} from '@/types/material'

export const snTracesService = {
  /** GET /api/v1/sn-traces —— SN 列表 */
  list(query: SnTraceListQuery = {}, signal?: AbortSignal): Promise<PageResult<SnTrace>> {
    return httpGet<PageResult<SnTrace>>('/sn-traces', compactParams({ ...query }), { signal })
  },

  /** GET /api/v1/sn-traces/{sn} —— 详情（单快照 + 工单级上下文） */
  detail(sn: string, signal?: AbortSignal): Promise<SnTraceDetail> {
    return httpGet<SnTraceDetail>(`/sn-traces/${encodeURIComponent(sn)}`, undefined, { signal })
  },

  /** POST /api/v1/sn-traces —— 创建 SN 快照（productCode 服务端取自工单） */
  create(payload: CreateSnTracePayload, signal?: AbortSignal): Promise<SnTrace> {
    return httpPost<SnTrace>('/sn-traces', payload, { signal })
  },

  /** PATCH /api/v1/sn-traces/{sn} —— 更新当前快照（不修改 producedAt） */
  update(sn: string, payload: UpdateSnTracePayload, signal?: AbortSignal): Promise<SnTrace> {
    return httpPatch<SnTrace>(`/sn-traces/${encodeURIComponent(sn)}`, payload, { signal })
  },

  /** POST /api/v1/sn-traces/{sn}/exports —— JSON 追溯导出（Q7：仅 JSON） */
  export(sn: string, signal?: AbortSignal): Promise<SnTraceExportResult> {
    return httpPost<SnTraceExportResult>(
      `/sn-traces/${encodeURIComponent(sn)}/exports`,
      { format: 'json' },
      { signal },
    )
  },
}
