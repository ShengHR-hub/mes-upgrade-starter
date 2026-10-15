/**
 * 物料批次响应 DTO —— 契约 §6.6 `Batch`。
 *
 * ⚠️ `qty` 仅表示**入库数量**，不得称为可用库存（无出库/占用流水）。
 */
export interface MaterialBatchResponse {
  id: string;
  batchNo: string;
  materialCode: string;
  qty: number;
  inboundAt: string | null;
  supplier: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}
