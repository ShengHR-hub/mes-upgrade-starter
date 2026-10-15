export interface RootCauseCauseItem {
  text: string;
  evidenceRefs: string[];
}

export interface RootCauseAnalysisResponse {
  alertId: string;
  possibleCauses: RootCauseCauseItem[];
  suggestion: string | null;
  analysisStatus: 'hypothesis' | 'insufficient_evidence' | 'no_anomaly' | string;
  explanation: string | null;
  mode: string;
  degraded: boolean;
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}
