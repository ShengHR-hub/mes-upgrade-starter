import type { LineProductionMetrics } from '../../dashboards/dto/dashboard-response.dto.js';
import type { RootCauseCauseItem } from '../../alerts/dto/root-cause-analysis-response.dto.js';

export interface DailyReportOverview {
  planQty: number;
  planTotalQty: number;
  doneQty: number;
  outputQty: number;
  goodQty: number;
  badQty: number;
  completionRate: number | null;
  goodRate: number | null;
  isTrueFpy: boolean;
  text: string;
}

export interface DailyReportAlertItem {
  alertId: string;
  type: string;
  title: string;
  possibleCauses: RootCauseCauseItem[];
  explanation: string | null;
  suggestion: string | null;
  analysisStatus: string;
}

export interface DailyReportSuggestionItem {
  alertId: string;
  text: string;
}

export interface DailyReportResponse {
  date: string;
  answerStatus: 'answered' | 'no_data';
  overview: DailyReportOverview;
  linePerformance: LineProductionMetrics[];
  alerts: DailyReportAlertItem[];
  suggestions: DailyReportSuggestionItem[];
  mode: string;
  degraded: boolean;
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}
