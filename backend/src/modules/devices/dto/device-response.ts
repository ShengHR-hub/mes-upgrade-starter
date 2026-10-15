/**
 * 设备响应 DTO —— 契约 §6.7 `Device`。
 *
 * 主数据来源为企业设备清单（`enterprise-master`）；**当前状态与演示固定约束
 * 属演示口径**，因此带 `statusDataSource:"demo"` 与 `dataLabel`（契约 §6.1 示例）。
 *
 * 车间/产线取主数据原值，不从编号推导（契约 §6.1）。
 */
export interface DeviceResponse {
  code: string;
  name: string;
  workshop: string;
  prodLine: string | null;
  status: string;
  purchaseYear: number | null;
  supplier: string | null;
  remark: string | null;
  updatedAt: string | null;
  dataSource: 'enterprise-master';
  statusDataSource: 'demo';
  dataLabel: '演示数据';
}

/** 设备状态日志响应 DTO —— 契约 §6.7 state-logs 示例。 */
export interface DeviceStateLogResponse {
  id: string;
  deviceCode: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string | null;
  remark: string | null;
  changedAt: string | null;
  dataSource: 'demo';
  dataLabel: '演示数据';
}

/**
 * OEE 分析响应 DTO —— 契约 §6.7。
 *
 * Q3 的 OEE 验收已确认调整为「显示缺失项说明」：缺计划生产时间、设备产出归属、
 * 理想节拍等输入时，`availability/performance/quality/oee` 均为 **null**，
 * `calculationStatus:"insufficient_data"`，`missingInputs` 列出实际缺失项。
 * 不用随机数、默认值或产线良品率冒充 OEE。
 */
export interface DeviceOeeResponse {
  deviceCode: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  calculationStatus: 'insufficient_data';
  missingInputs: string[];
  dataSource: 'demo';
  dataLabel: '演示数据';
}

/** OEE 三项恒定缺失输入（契约 §6.7 / §10.1：本版表结构不支持） */
export const OEE_MISSING_INPUTS: readonly string[] = ['计划生产时间', '设备产出归属', '理想节拍'];
