/**
 * B1 生产订单服务（契约 §6.2）。
 *
 * 全部经 `services/http.ts` 统一客户端发起 —— 不新建 axios 实例、
 * 不重复实现包体拆解与错误映射。
 *
 * 权限（契约 §5.2）：订单接口仅 admin / manager 可访问；后端会真实鉴权。
 */

import { httpGet, httpPatch, httpPost } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type {
  CreateOrderPayload,
  Order,
  OrderConfirmation,
  OrderListQuery,
  UpdateOrderPayload,
} from '@/types/order'

export const ordersService = {
  list(query: OrderListQuery, signal?: AbortSignal): Promise<PageResult<Order>> {
    return httpGet<PageResult<Order>>('/orders', compactParams({ ...query }), { signal })
  },

  detail(id: string, signal?: AbortSignal): Promise<Order> {
    return httpGet<Order>(`/orders/${encodeURIComponent(id)}`, undefined, { signal })
  },

  create(payload: CreateOrderPayload, signal?: AbortSignal): Promise<Order> {
    return httpPost<Order>('/orders', payload, { signal })
  },

  update(id: string, payload: UpdateOrderPayload, signal?: AbortSignal): Promise<Order> {
    return httpPatch<Order>(`/orders/${encodeURIComponent(id)}`, payload, { signal })
  },

  /**
   * 确认订单（一单一工单）。
   *
   * `expectedStatus` 是请求控制字段（契约 §2.4），用于避免覆盖他人已完成的确认。
   * 重复确认属恢复读取行为，后端会返回现有唯一工单。
   */
  confirm(id: string, expectedStatus: string, signal?: AbortSignal): Promise<OrderConfirmation> {
    return httpPost<OrderConfirmation>(
      `/orders/${encodeURIComponent(id)}/confirmations`,
      { expectedStatus },
      { signal },
    )
  },
}
