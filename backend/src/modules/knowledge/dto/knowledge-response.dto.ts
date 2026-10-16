/**
 * F1 企业知识问答响应类型 —— 契约 §7.3。
 *
 * 与 AI 服务内部响应字段保持一致；NestJS 代理层只做透传与结构校验，
 * 不改写 answer / citations / mode 等任何字段（「LLM 与代理不得改写指标」口径）。
 */

export interface RagCitationItem {
  sourceName: string;
  chunkId: string;
  relevance: number;
  excerpt?: string;
}

export interface RagAnswerResponse {
  answerStatus: string;
  answer: string;
  citations: RagCitationItem[];
  knowledgeSource?: string | null;
  reason?: string | null;
  mode: string;
  degraded: boolean;
  usage?: { tokensIn: number; tokensOut: number };
  latencyMs: number;
}

export interface KnowledgeSourceItem {
  sourceName: string;
  chunkCount: number;
  dataSource?: string | null;
}

export interface KnowledgeSourcesPageResponse {
  list: KnowledgeSourceItem[];
  total: number;
  page: number;
  pageSize: number;
  knowledgeSource?: string | null;
  chunkTotal?: number | null;
}
