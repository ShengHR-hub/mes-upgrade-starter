export interface UserContextDto {
  userId: string;
  role: string;
}

export interface InternalEvidenceItem {
  type: string;
  resourceId: string;
  ref: string;
  fact: string;
}

export interface InternalCauseItem {
  text: string;
  evidenceRefs: string[];
}

export interface InternalAlertItem {
  type: string;
  id?: string | number | null;
  alertId?: string | number | null;
  level?: string | null;
  title?: string | null;
  content?: string | null;
  refType?: string | null;
  refId?: string | number | null;
  status?: string | null;
  createdAt?: string | null;
  dataSource?: string | null;
  dataLabel?: string | null;
  possibleCauses?: InternalCauseItem[];
  explanation?: string | null;
  suggestion?: string | null;
  analysisStatus?: string | null;
}

export interface InternalRootCauseRequest {
  alert: InternalAlertItem;
  evidence: InternalEvidenceItem[];
  snapshotAt: string;
  userContext: UserContextDto;
  requestId: string;
}

export interface InternalRootCauseResponseData {
  possibleCauses: InternalCauseItem[];
  suggestion: string;
  analysisStatus: 'hypothesis' | 'insufficient_evidence' | 'no_anomaly' | string;
  explanation?: string;
  mode: 'local' | 'llm' | string;
  degraded: boolean;
  usage?: { tokensIn: number; tokensOut: number };
  latencyMs: number;
}

export interface InternalDailyReportRequest {
  date: string;
  metrics: Record<string, any>;
  alerts: InternalAlertItem[];
  snapshotAt: string;
  userContext: UserContextDto;
  requestId: string;
}

export interface InternalDailyReportResponseData {
  answerStatus: 'answered' | 'no_data';
  overview: Record<string, any>;
  overviewText: string;
  linePerformance: Array<Record<string, any>>;
  alerts: InternalAlertItem[];
  suggestions: string[];
  dataSource: string;
  dataLabel: string;
  date: string;
  mode: 'local' | 'llm' | string;
  degraded: boolean;
  usage?: { tokensIn: number; tokensOut: number };
  latencyMs: number;
  snapshotAt: string;
}

export interface InternalEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId?: string;
}

// ---------------------------------------------------------------- F3 智能问数（S9）

/** 契约 §4.1 内部意图对象（白名单集合，绝不接受白名单外取值） */
export interface InternalQueryIntentSpec {
  metric: string;
  groupBy: string;
  startDate: string;
  endDate: string;
  prodLine: string | null;
  operation: string;
}

export interface InternalQueryIntentRequest {
  question: string;
  dateContext: { today: string; timeZone: string };
  userContext: UserContextDto;
  requestId: string;
}

export interface InternalQueryIntentResponseData {
  supported: boolean;
  intent?: InternalQueryIntentSpec;
  reason?: string;
  clarificationRequired?: boolean;
  usage?: { tokensIn: number; tokensOut: number };
  latencyMs: number;
}

/** 契约 §7.1 数字与来源 DTO（NestJS 提供，FastAPI 只解读不补数字） */
export interface InternalQueryColumnItem {
  key: string;
  label: string;
  type?: string | null;
  unit?: string | null;
}

export interface InternalQuerySourceItem {
  resource: string;
  filters?: Record<string, unknown> | null;
}

export interface InternalQueryResultPayload {
  answerStatus?: string | null;
  answer?: string | null;
  query?: {
    metric: string;
    startDate?: string | null;
    endDate?: string | null;
    prodLine?: string | null;
  };
  columns: InternalQueryColumnItem[];
  rows: Array<Record<string, unknown>>;
  sources: InternalQuerySourceItem[];
  mode?: string | null;
  degraded?: boolean;
  snapshotAt?: string | null;
  dataSource?: string | null;
  dataLabel?: string | null;
}

export interface InternalQueryAnswerRequest {
  question: string;
  queryResult: InternalQueryResultPayload;
  userContext: UserContextDto;
  requestId: string;
}

export interface InternalQueryAnswerResponseData {
  answerStatus: 'answered' | 'no_data' | string;
  answer: string;
  mode: 'local' | 'llm' | string;
  degraded: boolean;
  usage?: { tokensIn: number; tokensOut: number };
  latencyMs: number;
}

// ---------------------------------------------------------------- F1 企业知识问答（RAG）

export interface InternalRagAnswerRequest {
  question: string;
  topK: number;
  userContext: UserContextDto;
  requestId: string;
}

export interface InternalRagCitationItem {
  sourceName: string;
  chunkId: string;
  relevance: number;
  excerpt?: string;
}

export interface InternalRagAnswerResponseData {
  answerStatus: 'answered' | 'not_found' | string;
  answer: string;
  citations: InternalRagCitationItem[];
  knowledgeSource?: string | null;
  reason?: string | null;
  mode: 'local' | 'llm' | string;
  degraded: boolean;
  usage?: { tokensIn: number; tokensOut: number };
  latencyMs: number;
}

export interface InternalKnowledgeSourceItem {
  sourceName: string;
  chunkCount: number;
  dataSource?: string | null;
}

export interface InternalKnowledgeSourcesResponseData {
  list: InternalKnowledgeSourceItem[];
  total: number;
  page: number;
  pageSize: number;
  knowledgeSource?: string | null;
  chunkTotal?: number | null;
  latencyMs?: number | null;
}
