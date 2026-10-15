import type { OrderStatus } from '../order-status.js';

/**
 * 响应 DTO —— 严格对齐契约 §6.1 的 `Order` 示例与 §6.2 的确认响应。
 *
 * 形状要点：
 * - BIGINT ID 一律为十进制字符串；
 * - `dueDate` 为 `YYYY-MM-DD`（DATE），`createdAt` 为 RFC 3339（`+08:00`）；
 * - `createdBy` 为服务端可信身份，可为 null；
 * - 业务流水附 `dataSource:"demo"` + `dataLabel:"演示数据"`（契约 §2.3）。
 */

export interface OrderResponse {
  id: string;
  code: string;
  productCode: string;
  qty: number;
  dueDate: string;
  status: OrderStatus | string;
  createdBy: string | null;
  createdAt: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}

/** 确认响应中的工单摘要（契约 §6.2：`{"id":"201","code":"WO-…","taskCount":10}`） */
export interface ConfirmationWorkOrderSummary {
  id: string;
  code: string;
  taskCount: number;
}

export interface OrderConfirmationResponse {
  orderId: string;
  status: OrderStatus | string;
  workOrders: ConfirmationWorkOrderSummary[];
  dataSource: 'demo';
  dataLabel: '演示数据';
}
