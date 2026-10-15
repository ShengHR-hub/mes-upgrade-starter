/**
 * SN 追溯响应 DTO —— 契约 §6.6 `SnTrace` / 详情 / 导出。
 *
 * ⚠️ 单快照语义：一个 SN 仅有一个当前快照及一个批次；工单工序/检验只是
 * **关联上下文**，不是该 SN 已证实的逐工序、逐件检验历史（coverage/limitations
 * 在详情与导出中必须保留）。
 */
export interface SnTraceResponse {
  id: string;
  sn: string;
  workOrderId: string;
  productCode: string;
  taskId: string | null;
  operatorId: string | null;
  deviceCode: string | null;
  batchId: string | null;
  qcResult: string | null;
  producedAt: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}

/** 详情接口的关联上下文（工单级任务与检验记录，仅作参考） */
export interface SnTraceContextResponse {
  tasks: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
}

/** 详情接口 data（契约 §6.6 示例形状） */
export interface SnTraceDetailResponse {
  trace: SnTraceResponse;
  context: SnTraceContextResponse;
  coverage: 'single-snapshot-with-work-order-context';
  limitations: string[];
  dataSource: 'demo';
  dataLabel: '演示数据';
}

/** 导出接口 data（契约 §6.6 示例形状；Q7：仅 JSON，保留限制说明） */
export interface SnTraceExportResponse {
  fileName: string;
  mediaType: 'application/json';
  content: string;
  coverage: 'single-snapshot-with-work-order-context';
  dataSource: 'demo';
  dataLabel: '演示数据';
}

/** 详情/导出固定限制说明（契约 §6.6 / §10.1；不得删除或弱化） */
export const SN_TRACE_LIMITATIONS: readonly string[] = [
  '工单级记录不能证明该SN逐工序经历',
  '一个SN仅支持一个批次',
  '不宣称实现完整多批次血缘或满足 IATF 16949',
];
