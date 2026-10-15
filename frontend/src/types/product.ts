/**
 * 产品主数据（契约 §6.6 的 `GET /api/v1/products`）。
 *
 * ⚠️ 这是 S5 为订单选择产品补的**最小只读**接口，沿用冻结契约形状，不属于 B5 全量实现。
 * 主数据来源为 `enterprise-master`，**不带 dataLabel**，不得标注为演示数据。
 */

import type { DataSourceMeta, PaginationQuery } from './api'

export interface Product extends DataSourceMeta {
  code: string
  name: string
  line: string
  monthlyOutput: number
  unit: string | null
  stdHours: string | null
  remark: string | null
}

export interface ProductListQuery extends PaginationQuery {
  keyword?: string
  line?: string
}
