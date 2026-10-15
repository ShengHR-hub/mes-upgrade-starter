/**
 * 问数提交判定（S9 审查 P2-6 修复 / 二轮审查修正）。
 *
 * 一轮修复用「问题文本」做在途身份，存在缺陷：取消按钮只 abort 请求，
 * 若底层 Promise 不响应 AbortSignal 则身份残留，同一问题将永久被误判为
 * 重复提交（取消与重复提交状态不可靠）。文本也不是请求身份——相同文本的
 * 两次查询是不同请求。
 *
 * 本版改用**提交 token**（每次提交唯一 id）记录在途请求，并只在其仍处于
 * useAsyncTask 的真实在途状态（loading）时才算重复：
 * - 空问题 → duplicate（无可提交内容）；
 * - 在途请求**且**问题相同 → duplicate（防重复提交）；
 * - 其余（不同问题 = 新请求；请求已结束 = 重新提交）→ accept。
 */

export type SubmitDecision = 'accept' | 'duplicate'

/** 在途提交身份：token 与提交时的问题快照 */
export interface SubmitIdentity {
  id: number
  question: string
}

export function decideSubmit(
  inFlight: SubmitIdentity | null,
  nextQuestion: string,
  inFlightActive: boolean,
): SubmitDecision {
  const next = (nextQuestion ?? '').trim()
  if (!next) return 'duplicate'
  // 仅当「确有请求在途」时才可能构成重复提交；取消/失败/完成后同问题可再次提交
  if (inFlightActive && inFlight !== null && inFlight.question === next) {
    return 'duplicate'
  }
  return 'accept'
}
