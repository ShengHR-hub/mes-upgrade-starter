/**
 * 响应 DTO —— 严格对齐契约 §6.1 的 `WorkOrder` / `Task` 示例与 §6.3 的流转响应。
 */

export interface WorkOrderResponse {
  id: string;
  code: string;
  saleOrderId: string | null;
  productCode: string;
  qty: number;
  /** 末道工序累计良品；本轮不实现累计逻辑（属 B3），保持数据库原值 */
  doneQty: number;
  status: string;
  planStart: string | null;
  planEnd: string | null;
  createdBy: string | null;
  createdAt: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}

export interface TaskResponse {
  id: string;
  workOrderId: string;
  seq: number;
  stepName: string;
  workshop: string | null;
  prodLine: string | null;
  deviceCode: string | null;
  operatorId: string | null;
  planQty: number;
  goodQty: number;
  badQty: number;
  status: string;
  /** DATETIME → RFC 3339（+08:00） */
  planStart: string | null;
  planEnd: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}

export interface WorkOrderTransitionResponse {
  id: string;
  status: string;
  dataSource: 'demo';
  dataLabel: '演示数据';
}

export interface TaskTransitionResponse {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}
