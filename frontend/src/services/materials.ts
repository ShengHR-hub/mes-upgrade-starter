/**
 * B5 物料管理服务（契约 §6.6）。
 *
 * 覆盖：物料列表 / 安全库存修改、产品 BOM 查询与增删改、物料批次入库与批次反查。
 * `qty` 一律按**十进制字符串**传递（BOM），批次 `qty` 是整数入库数量。
 */

import { httpDelete, httpGet, httpPatch, httpPost } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type {
  Bom,
  BomListQuery,
  CreateBomPayload,
  CreateMaterialBatchPayload,
  Material,
  MaterialBatch,
  MaterialBatchListQuery,
  MaterialListQuery,
  SnTrace,
  UpdateBomPayload,
} from '@/types/material'

export const materialsService = {
  /** GET /api/v1/materials —— 物料列表（企业主数据） */
  list(query: MaterialListQuery = {}, signal?: AbortSignal): Promise<PageResult<Material>> {
    return httpGet<PageResult<Material>>('/materials', compactParams({ ...query }), { signal })
  },

  /** PATCH /api/v1/materials/{code} —— 仅安全库存（admin/manager） */
  updateSafetyStock(code: string, safetyStock: number, signal?: AbortSignal): Promise<Material> {
    return httpPatch<Material>(`/materials/${encodeURIComponent(code)}`, { safetyStock }, { signal })
  },
}

export const bomsService = {
  /** GET /api/v1/products/{code}/boms —— 产品 BOM 列表 */
  list(
    productCode: string,
    query: BomListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<Bom>> {
    return httpGet<PageResult<Bom>>(
      `/products/${encodeURIComponent(productCode)}/boms`,
      compactParams({ ...query }),
      { signal },
    )
  },

  /** POST /api/v1/products/{code}/boms —— 新增 BOM 行（admin/manager） */
  create(
    productCode: string,
    payload: CreateBomPayload,
    signal?: AbortSignal,
  ): Promise<Bom> {
    return httpPost<Bom>(`/products/${encodeURIComponent(productCode)}/boms`, payload, { signal })
  },

  /** PATCH /api/v1/boms/{id} —— 修改 level/qty/unit（admin/manager；引用保护 30004） */
  update(id: string, payload: UpdateBomPayload, signal?: AbortSignal): Promise<Bom> {
    return httpPatch<Bom>(`/boms/${encodeURIComponent(id)}`, payload, { signal })
  },

  /** DELETE /api/v1/boms/{id} —— 删除 BOM 行（admin/manager；引用保护 30004） */
  remove(id: string, signal?: AbortSignal): Promise<null> {
    return httpDelete<null>(`/boms/${encodeURIComponent(id)}`, { signal })
  },
}

export const materialBatchesService = {
  /** GET /api/v1/material-batches —— 批次列表 */
  list(
    query: MaterialBatchListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<MaterialBatch>> {
    return httpGet<PageResult<MaterialBatch>>(
      '/material-batches',
      compactParams({ ...query }),
      { signal },
    )
  },

  /** POST /api/v1/material-batches —— 批次入库（三角色） */
  create(
    payload: CreateMaterialBatchPayload,
    signal?: AbortSignal,
  ): Promise<MaterialBatch> {
    return httpPost<MaterialBatch>('/material-batches', payload, { signal })
  },

  /** GET /api/v1/material-batches/{id}/sn-traces —— 批次反查绑定 SN */
  listSnTraces(
    batchId: string,
    query: MaterialBatchListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<SnTrace>> {
    return httpGet<PageResult<SnTrace>>(
      `/material-batches/${encodeURIComponent(batchId)}/sn-traces`,
      compactParams({ ...query }),
      { signal },
    )
  },
}
