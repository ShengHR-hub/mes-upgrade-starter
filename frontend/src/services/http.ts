/**
 * 统一 HTTP 客户端（S4 要求第 5 条）。
 *
 * 约定：
 * - 开发环境经 Vite 同源代理把 `/api` 转发到 NestJS `http://127.0.0.1:3001`；
 *   **不代理 `/api/v1/ai/*` 到 FastAPI 8000**，浏览器不直连 AI 服务或数据库；
 * - 统一处理 `{ code, message, data }`；HTTP 200 但 `code != 0` 仍按业务失败处理；
 * - 固定超时 + 可取消（通过 `AbortSignal`）；
 * - 不自动重试 POST / PATCH / DELETE，也不静默重发业务提交；
 * - 不打印请求体、密码或 Authorization。
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

import type { ApiResponse } from '@/types/api'

import { businessErrorFrom, checkEnvelope, malformedError, readRequestId, toApiError } from './api-error'

/** 统一超时（毫秒）。超时后按 `DEPENDENCY_TIMEOUT` 语义提示，不静默重发。 */
export const HTTP_TIMEOUT_MS = 15_000

/** 契约 §2.1：业务路径统一 `/api/v1` 前缀；同源代理负责转发到 3001 */
export const API_BASE_URL = '/api/v1'

let accessTokenProvider: () => string | null = () => null
let unauthorizedHandler: (() => void) | null = null

/**
 * 注册访问令牌提供者（令牌只保存在内存，见 `stores/auth.ts`）。
 * 令牌绝不写入 localStorage / sessionStorage。
 */
export function setAccessTokenProvider(provider: () => string | null): void {
  accessTokenProvider = provider
}

/**
 * 注册 401 处理回调（清理认证态 + 进入登录流程）。
 * 只在「此前已持有令牌」时触发，避免登录页自身的 401 造成跳转循环或重复弹窗。
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

function notifyUnauthorized(): void {
  if (accessTokenProvider() === null) return
  unauthorizedHandler?.()
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: HTTP_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
})

httpClient.interceptors.request.use((config) => {
  const token = accessTokenProvider()
  if (token) {
    // axios 1.x：config.headers 为 AxiosHeaders，set 方法存在
    config.headers.set?.('Authorization', `Bearer ${token}`)
  }
  return config
})

httpClient.interceptors.response.use(
  (response) => {
    const requestId = readRequestId(response.headers)
    const body = response.data as unknown

    // 先校验包体完整性：{code,message,data} 三者缺一不可（data 可为 null）
    // 审查修复（第一轮）：初版只检查 code 是否为数字，缺 message/data 的不完整响应
    // 会被当作成功并让调用方拿到 undefined。
    const envelopeCheck = checkEnvelope(body)
    if (!envelopeCheck.ok) {
      throw malformedError(envelopeCheck.reason ?? '响应结构不完整', response.status, requestId)
    }

    const envelope = body as ApiResponse<unknown>
    if (envelope.code !== 0) {
      const error = businessErrorFrom(envelope, response.status, requestId)
      if (error.isAuthExpired) notifyUnauthorized()
      throw error
    }
    return response
  },
  (error: unknown) => {
    const apiError = toApiError(error)
    if (apiError.isAuthExpired) notifyUnauthorized()
    throw apiError
  },
)

/** 发起请求并拆包，返回 `data` */
export async function httpRequest<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await httpClient.request<ApiResponse<T>>(config)
  return response.data.data
}

export function httpGet<T>(
  url: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig,
): Promise<T> {
  return httpRequest<T>({ ...config, method: 'GET', url, params })
}

export function httpPost<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return httpRequest<T>({ ...config, method: 'POST', url, data })
}

export function httpPatch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return httpRequest<T>({ ...config, method: 'PATCH', url, data })
}

export function httpDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return httpRequest<T>({ ...config, method: 'DELETE', url })
}
