/**
 * B12 MRP-lite 类型（契约 §6.10，受限）。
 *
 * 边界（前端必须如实展示，不得自行推导）：
 * - 只返回**平面 BOM 毛需求**（订单数量 × BOM 用量）；
 * - `availableQty` / `shortageQty` / `purchaseSuggestionQty` 服务端恒为 null
 *   （无出库/占用/调整/采购在途流水）——前端不得把 null 显示成 0，不得自行相减；
 * - `inboundQty` 只是累计入库数量，不等于可用库存；
 * - `grossRequiredQty` 为十进制字符串（如 "200.00"），保持原样展示。
 */

import type { DataSourceMeta, DecimalString } from './api'

export interface MaterialRequirementItem {
  materialCode: string
  grossRequiredQty: DecimalString
  inboundQty: number
  availableQty: null
  shortageQty: null
  purchaseSuggestionQty: null
}

export interface MaterialRequirementCalculationResponse extends DataSourceMeta {
  orderIds: string[]
  items: MaterialRequirementItem[]
  calculationScope: 'flat-bom-gross-requirements'
  limitations: string[]
  snapshotAt: string | null
}

export interface MaterialRequirementRequest {
  orderIds: string[]
}
