/**
 * 产品主数据响应 DTO —— 对齐契约 §6.6 的 `Page({...})` 示例：
 *
 * ```json
 * {"code":"JC-PLC-2001","name":"<企业产品名称>","line":"工业控制板卡","monthlyOutput":0,
 *  "unit":"片","stdHours":"0.00","remark":null,"dataSource":"enterprise-master"}
 * ```
 *
 * 注意：
 * - `stdHours` 是 DECIMAL，按契约 §2.1 用**字符串**（如 `"0.00"`）；
 * - **没有** `dataLabel`：真实主数据不得标注为演示数据（契约 §2.3）。
 */
export interface ProductResponse {
  code: string;
  name: string;
  line: string;
  monthlyOutput: number;
  unit: string | null;
  stdHours: string | null;
  remark: string | null;
  dataSource: 'enterprise-master';
}
