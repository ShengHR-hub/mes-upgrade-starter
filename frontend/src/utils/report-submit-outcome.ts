/**
 * 报工提交失败的结局判定（纯函数，S11 复审 P2 修复）。
 *
 * 背景：追加写入（报工/检验/批次）在「请求已发出但响应丢失」时，服务端**可能已应用**。
 * 若一律按「未提交」重新入队，用户可能重复发送同一笔报工。
 *
 * 本模块只回答一个问题：**这次失败，服务端到底有没有可能已经写入？**
 * - `unknown-result`：可能已应用（网络错误 / 超时 / 5xx / 响应不可解析）→ 记录转
 *   「结果未知」，禁止普通补交，必须人工核查；
 * - `definitely-rejected`：确定未应用（参数错误 400 / 冲突 409 / 无权限 403 /
 *   未认证 401 / 业务拒绝 code!=0 / 已取消）→ 不入队，用户修正后可直接再次提交。
 *
 * 注意：本判定**不是**持久幂等方案（Q9 未批准）；它只决定前端如何诚实呈现状态。
 */

import { isApiError } from '@/services/api-error'

export type SubmitFailureOutcome = 'unknown-result' | 'definitely-rejected';

/** 确定「未被服务端应用」的错误类型（请求被拒绝或从未到达业务逻辑） */
const DEFINITELY_REJECTED_KINDS: readonly string[] = [
  'business', // HTTP 200 + code!=0：服务端处理并拒绝
  'invalid-argument', // 400
  'not-found', // 404
  'conflict', // 409
  'forbidden', // 403
  'rate-limited', // 429
  'unauthenticated', // 401：未过鉴权，不会执行业务写入
  'canceled', // 客户端取消 / 被新一轮取代
];

/**
 * 判定一次提交失败的结局。
 *
 * @param error `ReportsService.create` 抛出的错误（通常为 ApiError）
 */
export function classifySubmitFailure(error: unknown): SubmitFailureOutcome {
  if (!isApiError(error)) {
    // 非 API 错误（未知异常）：无法证明未被应用 → 按结果不明处理（保守）
    return 'unknown-result';
  }
  if (DEFINITELY_REJECTED_KINDS.includes(error.kind)) {
    return 'definitely-rejected';
  }
  // network / timeout / server / dependency / malformed / unknown：
  // 请求可能已被服务端应用，或响应不可用 → 结果不明
  return 'unknown-result';
}
