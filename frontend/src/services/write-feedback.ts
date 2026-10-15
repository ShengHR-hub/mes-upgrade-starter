/**
 * 写请求的失败提示（S5 交互要求第 3 条）。
 *
 * 规则：
 * - **超时 / 断网 / 依赖超时**：结果可能已在服务端生效，也可能没有 →
 *   提示「结果未确认，请查询核对」，**绝不自动重发**；
 * - 其余错误（400 / 403 / 409 / 422…）由统一客户端映射文案后正常提示；
 * - 401 由 `services/http.ts` 的 401 处理器进入重新登录流程，这里不重复处理。
 */

import { ElMessage } from 'element-plus'

import { showApiError } from './notify'
import { toApiError } from './api-error'

/** 结果未确认的标准文案 */
export const UNCONFIRMED_RESULT_TEXT = '结果未确认，请查询核对。'

/**
 * 判断错误是否属于「结果未确认」。
 *
 * 覆盖：请求超时（ECONNABORTED）、断网（无响应）、依赖超时/不可用（50002/50003）。
 * 这些场景下服务端是否已提交无法从前端判定，因此一律按「未确认」处理。
 */
export function isResultUnconfirmed(error: unknown): boolean {
  const kind = toApiError(error).kind
  return kind === 'timeout' || kind === 'network' || kind === 'dependency'
}

/** 统一的写请求失败提示入口 */
export function showWriteError(error: unknown): void {
  if (isResultUnconfirmed(error)) {
    ElMessage({
      type: 'warning',
      message: `${UNCONFIRMED_RESULT_TEXT}（本次提交不会自动重发，请刷新列表确认）`,
      duration: 6_000,
      showClose: true,
    })
    return
  }
  showApiError(error)
}
