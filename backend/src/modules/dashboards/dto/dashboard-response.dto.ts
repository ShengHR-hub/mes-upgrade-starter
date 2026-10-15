export interface LineProductionMetrics {
  prodLine: string;
  planQty: number;
  planTotalQty: number;
  doneQty: number;
  outputQty: number;
  goodQty: number;
  badQty: number;
  completionRate: number | null;
  goodRate: number | null;
}

export interface SummaryProductionMetrics {
  planQty: number;
  planTotalQty: number;
  doneQty: number;
  outputQty: number;
  goodQty: number;
  badQty: number;
  completionRate: number | null;
  goodRate: number | null;
  isTrueFpy: boolean;
  calculationStatus: 'available' | 'no_data' | 'insufficient_data';
  missingInputs?: string[];
}

export interface DashboardProductionMetricsResponse {
  startDate: string;
  endDate: string;
  snapshotAt: string;
  metrics: SummaryProductionMetrics;
  lines: LineProductionMetrics[];
  dataSource: string;
  dataLabel: string;
}

export interface DashboardQualityMetricsResponse {
  goodQty: number;
  badQty: number;
  goodRate: number | null;
  isTrueFpy: boolean;
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

export interface DashboardDeviceMetricsResponse {
  counts: {
    运行中: number;
    待机: number;
    维修中: number;
    停机: number;
  };
  oee: null;
  calculationStatus: 'insufficient_data';
  missingInputs: string[];
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

export interface DashboardDeliveryMetricsResponse {
  orderCount: number;
  completedOrderCount: number;
  delayedOrderCount: number;
  calculationStatus: 'available' | 'no_data';
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

export interface RuleEvaluationItem {
  ruleId: 'goodRate' | 'completionRate' | 'deviceMaintenance';
  ruleName: string;
  threshold: number | string;
  actualValue: number | string | null;
  unit: string;
  triggered: boolean;
  explanation: string;
  level: '紧急' | '重要' | '一般';
  type: string;
  title: string;
  content: string;
  refType: string | null;
  refId: string | null;
}

export interface PureRuleEvaluationResult {
  snapshotAt: string;
  evaluations: RuleEvaluationItem[];
  triggeredCount: number;
}
