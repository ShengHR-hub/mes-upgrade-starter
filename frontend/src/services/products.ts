/**
 * 产品主数据只读服务（契约 §6.6，S5 最小只读补充）。
 *
 * 仅用于订单表单的产品选择与展示；**不实现 B5**（BOM / 工艺路线 / 物料 / 批次）。
 */

import { httpGet } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type { Product, ProductListQuery } from '@/types/product'

export const productsService = {
  list(query: ProductListQuery = {}, signal?: AbortSignal): Promise<PageResult<Product>> {
    return httpGet<PageResult<Product>>('/products', compactParams({ ...query }), { signal })
  },
}
