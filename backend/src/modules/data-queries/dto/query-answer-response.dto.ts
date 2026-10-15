/**
 * F3 智能问数响应 DTO —— 契约 §7.1 QueryAnswer。
 *
 * 边界：
 * - 数字全部来自 NestJS 受控查询（复用 S7 MetricsAggregationService 口径）；
 * - FastAPI 只负责把数字转述为文本，不补数字、不改数字；
 * - `dataSource:"demo"` + `dataLabel:"演示数据"` 为演示数据强制标识（契约 §2.3）；
 * - `clarification` 仅在 `answerStatus:"clarification_required"` 时非空。
 */

export type QueryAnswerStatus = 'answered' | 'no_data' | 'clarification_required';

export type QueryMetric =
  | 'goodRate'
  | 'completionRate'
  | 'goodQty'
  | 'badQty'
  | 'outputQty'
  | 'defectQty'
  | 'deviceStatus';

export type QueryGroupBy = 'prodLine' | 'date' | 'defectType' | 'device';

export type QueryOperation = 'list' | 'trend' | 'minimum' | 'maximum';

export interface QueryColumn {
  key: string;
  label: string;
  type?: string;
  unit?: string;
}

export interface QueryRow {
  [key: string]: unknown;
}

export interface QuerySource {
  resource: string;
  filters?: Record<string, unknown>;
}

export interface QuerySpec {
  metric: QueryMetric;
  groupBy: QueryGroupBy;
  operation: QueryOperation;
  startDate: string;
  endDate: string;
  prodLine: string | null;
}

export interface QueryAnswerResponse {
  answerStatus: QueryAnswerStatus;
  answer: string;
  clarification: string | null;
  query: QuerySpec | null;
  columns: QueryColumn[];
  rows: QueryRow[];
  sources: QuerySource[];
  mode: string;
  degraded: boolean;
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}
