import { httpGet, httpPost } from './http'
import type { AiMode } from '@/types/ai'

/**
 * F1 企业知识问答服务 —— 契约 §7.3。
 *
 * 约定：
 * - 只调用 NestJS 公开接口（`POST /api/v1/rag-answers` / `GET /api/v1/knowledge-sources`）；
 * - 答案与引用由后端 + AI 服务基于 knowledge.json 产生，本服务不做任何内容加工；
 * - 支持 AbortSignal 取消（useAsyncTask 轮次隔离依赖它）。
 */

export type RagAnswerStatus = 'answered' | 'not_found'

export interface RagCitation {
  sourceName: string
  chunkId: string
  relevance: number
  excerpt?: string
}

export interface RagAnswerResponse {
  answerStatus: RagAnswerStatus
  answer: string
  citations: RagCitation[]
  knowledgeSource?: string | null
  reason?: string | null
  mode: AiMode
  degraded: boolean
  usage?: { tokensIn: number; tokensOut: number }
  latencyMs: number
}

export interface KnowledgeSourceItem {
  sourceName: string
  chunkCount: number
  dataSource?: string | null
}

export interface KnowledgeSourcesPageResponse {
  list: KnowledgeSourceItem[]
  total: number
  page: number
  pageSize: number
  knowledgeSource?: string | null
  chunkTotal?: number | null
}

export interface RagAnswerPayload {
  question: string
  topK?: number
}

export const KnowledgeService = {
  /** 发起知识问答（POST /api/v1/rag-answers） */
  answer(payload: RagAnswerPayload, signal?: AbortSignal): Promise<RagAnswerResponse> {
    return httpPost<RagAnswerResponse>('/rag-answers', payload, { signal })
  },

  /** 知识来源清单（GET /api/v1/knowledge-sources） */
  listSources(
    params?: { page?: number; pageSize?: number },
    signal?: AbortSignal,
  ): Promise<KnowledgeSourcesPageResponse> {
    return httpGet<KnowledgeSourcesPageResponse>('/knowledge-sources', params, { signal })
  },
}
