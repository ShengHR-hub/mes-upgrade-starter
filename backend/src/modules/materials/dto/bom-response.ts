/**
 * BOM 响应 DTO —— 契约 §6.6。
 *
 * ⚠️ `qty` 为精确十进制字符串（DECIMAL(10,2)，如 `"2.00"`），前端不得转 number 计算；
 * `level` 不是父子关联，禁止据此推断多层 BOM 树（契约 §6.6）。
 */
export interface BomResponse {
  id: string;
  productCode: string;
  level: number;
  materialCode: string;
  qty: string;
  unit: string | null;
  dataSource: 'enterprise-master';
}
