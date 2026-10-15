/**
 * 数据来源标识常量（契约 §2.3）。
 *
 * 规则：
 * - 业务流水（订单 / 工单 / 任务 / 报工…）→ `demo` + `演示数据`；
 * - 企业真实主数据（产品 / 物料 / 设备…）→ `enterprise-master`，**不得**标成演示数据，
 *   且契约 §6.6 的产品示例中**没有** `dataLabel`，因此主数据不附带该字段。
 */

export const DATA_SOURCE_DEMO = 'demo';
export const DATA_LABEL_DEMO = '演示数据';
export const DATA_SOURCE_ENTERPRISE_MASTER = 'enterprise-master';

/** 业务流水的来源元数据（展开进响应 data） */
export const DEMO_SOURCE_META = {
  dataSource: DATA_SOURCE_DEMO,
  dataLabel: DATA_LABEL_DEMO,
} as const;

/** 企业主数据的来源元数据（无 dataLabel，避免误标为演示数据） */
export const ENTERPRISE_MASTER_SOURCE_META = {
  dataSource: DATA_SOURCE_ENTERPRISE_MASTER,
} as const;
