/**
 * B12 MRP-lite 服务（契约 §6.10，受限）。只读计算，不持久化任何采购数据。
 * 仅 admin / manager 可用；operator 由服务端 403 拒绝。
 */

import { httpPost } from './http'

import type {
  MaterialRequirementCalculationResponse,
  MaterialRequirementRequest,
} from '@/types/material-requirement'

export const materialRequirementsService = {
  /** POST /api/v1/material-requirement-calculations —— 平面 BOM 毛需求（受限） */
  calculate(
    payload: MaterialRequirementRequest,
    signal?: AbortSignal,
  ): Promise<MaterialRequirementCalculationResponse> {
    return httpPost<MaterialRequirementCalculationResponse>(
      '/material-requirement-calculations',
      payload,
      { signal },
    )
  },
}
