/**
 * 全局错误提示（带去重，避免重复弹窗）。
 *
 * 只输出面向用户的安全文案；不输出请求体、密码或 Authorization。
 * 若响应带 `X-Request-Id`，一并展示，便于用户复制给开发排查。
 */

import { ElMessage } from 'element-plus'

import { describeApiError, toApiError } from './api-error'

/** 同一文案在窗口期内只提示一次，避免并发失败刷屏 */
export const NOTIFY_DEDUPE_WINDOW_MS = 3_000

const lastShownAt = new Map<string, number>()

export function resetNotifyDedupe(): void {
  lastShownAt.clear()
}

export function showApiError(error: unknown, overrideMessage?: string): void {
  const apiError = toApiError(error)
  const base = overrideMessage ?? describeApiError(apiError)
  const text = apiError.requestId ? `${base}（请求号：${apiError.requestId}）` : base

  const now = Date.now()
  const previous = lastShownAt.get(text)
  if (previous !== undefined && now - previous < NOTIFY_DEDUPE_WINDOW_MS) return
  lastShownAt.set(text, now)

  ElMessage({ type: 'error', message: text, duration: 4_000, showClose: true })
}

export function showWarning(message: string): void {
  ElMessage({ type: 'warning', message, duration: 4_000, showClose: true })
}

export function showInfo(message: string): void {
  ElMessage({ type: 'info', message, duration: 4_000, showClose: true })
}
