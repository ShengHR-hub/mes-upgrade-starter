/**
 * AI 相关展示类型 —— **本轮仅预留类型，不实现任何 AI 功能**（S4 要求第 6 条）。
 *
 * 用途：为 S8/S9（F1～F4 接入）预留统一的状态展示口径，避免后续各自造词。
 * 契约依据：§3 末段（`answerStatus` / `mode` / `degraded`）、§7.1～§7.3。
 */

/** 契约 §4.1 / §7：本地模式与 LLM 模式 */
export const AI_MODES = ['local', 'llm'] as const
export type AiMode = (typeof AI_MODES)[number]

export const AI_MODE_LABELS: Readonly<Record<AiMode, string>> = {
  local: '本地模式',
  llm: '大模型模式',
}

/**
 * 契约 §3 / §7 的诚实回答状态。
 * - `answered`：正常回答
 * - `no_data`：所查询范围没有可用数据（HTTP 200 / code 0，不是错误）
 * - `not_found`：资料中没有相关信息（RAG 超纲）
 * - `clarification_required`：意图不明确，需用户重述（契约 §7.1）
 */
export const ANSWER_STATUSES = ['answered', 'no_data', 'not_found', 'clarification_required'] as const
export type AnswerStatus = (typeof ANSWER_STATUSES)[number]

export const ANSWER_STATUS_LABELS: Readonly<Record<AnswerStatus, string>> = {
  answered: '已回答',
  no_data: '无可用数据',
  not_found: '资料中没有相关信息',
  clarification_required: '需要补充说明',
}

/**
 * AI 响应通用元数据（`degraded:true` 表示 LLM 不可用但本地模式仍可回答，契约 §3）。
 * 注意：不能把 FastAPI 整体不可达误标成「LLM 降级成功」（契约 §3）。
 */
export interface AiResponseMeta {
  mode?: AiMode
  degraded?: boolean
  answerStatus?: AnswerStatus
  snapshotAt?: string
}
