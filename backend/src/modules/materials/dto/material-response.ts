/**
 * 物料响应 DTO —— 契约 §6.6 `Material`。
 *
 * `safetyStock` 仅作记录（无可用库存流水，不构成预警依据）。
 */
export interface MaterialResponse {
  code: string;
  name: string;
  spec: string | null;
  category: string | null;
  unit: string | null;
  safetyStock: number;
  supplier: string | null;
  remark: string | null;
  dataSource: 'enterprise-master';
}
