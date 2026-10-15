/**
 * 统一的错误模型与映射（纯函数，便于单测）。
 *
 * 设计要点（S4 要求第 5 条）：
 * - HTTP 200 但 `code != 0` 仍按业务失败处理；
 * - 401 / 403 / 404 / 参数错误 / 依赖不可用 / 超时 分别给出合理提示；
 * - 403 不伪装成登录失效；401 才触发重新登录；
 * - 保留响应头 `X-Request-Id` 供用户复制排查；
 * - 不打印请求体、密码或 Authorization（本模块不做任何日志输出）。
 */

import { ERROR_CODES, type ApiResponse, type FieldError } from '@/types/api'

export type ApiErrorKind =
  | 'business'
  | 'invalid-argument'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'dependency'
  | 'timeout'
  | 'network'
  | 'server'
  | 'canceled'
  | 'malformed'
  | 'unknown'

export interface ApiErrorInit {
  kind: ApiErrorKind
  message: string
  code?: number | null
  httpStatus?: number | null
  requestId?: string | null
  fieldErrors?: FieldError[]
  cause?: unknown
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code: number | null
  readonly httpStatus: number | null
  readonly requestId: string | null
  readonly fieldErrors: FieldError[]
  readonly cause?: unknown

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.kind = init.kind
    this.code = init.code ?? null
    this.httpStatus = init.httpStatus ?? null
    this.requestId = init.requestId ?? null
    this.fieldErrors = init.fieldErrors ?? []
    this.cause = init.cause
  }

  /** 是否属于「登录态失效」——只有这一类才应触发重新登录 */
  get isAuthExpired(): boolean {
    return this.kind === 'unauthenticated'
  }

  /** 是否属于「无权限」——不得与登录失效混为一谈 */
  get isForbidden(): boolean {
    return this.kind === 'forbidden'
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

export interface EnvelopeCheck {
  ok: boolean
  reason: string | null
}

/**
 * 校验契约统一包体 `{ code, message, data }`（契约 §2.2）。
 *
 * 审查修复（第一轮）：初版只检查 `code` 是否为数字，导致
 * `{code:0}`、`{code:0,message:"成功"}` 这类**不完整响应**被当作成功，
 * 调用方拿到 `undefined` 后可能误判成功或渲染异常。
 *
 * 规则：
 * - `code` 必须是有限数字；
 * - `message` 必须是字符串；
 * - `data` 键**必须存在**（契约规定「不需返回实体时使用 `data:null`」，故允许 null，但不得缺失）。
 */
export function checkEnvelope(body: unknown): EnvelopeCheck {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: '响应不是 JSON 对象' }
  }
  const record = body as Record<string, unknown>
  if (typeof record.code !== 'number' || !Number.isFinite(record.code)) {
    return { ok: false, reason: '缺少数字类型的 code 字段' }
  }
  if (typeof record.message !== 'string') {
    return { ok: false, reason: '缺少字符串类型的 message 字段' }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'data')) {
    return { ok: false, reason: '缺少 data 字段（契约要求始终存在，可为 null）' }
  }
  return { ok: true, reason: null }
}

/** 是否为符合契约的统一包体 */
export function isContractEnvelope(body: unknown): body is ApiResponse<unknown> {
  return checkEnvelope(body).ok
}

/** 构造「响应不符合契约」的错误 */
export function malformedError(
  reason: string,
  httpStatus: number | null,
  requestId: string | null,
  cause?: unknown,
): ApiError {
  return new ApiError({
    kind: 'malformed',
    message: `响应格式不符合接口契约（${reason}）。`,
    httpStatus,
    requestId,
    cause,
  })
}

function codeToKind(code: number): ApiErrorKind {
  switch (code) {
    case ERROR_CODES.INVALID_ARGUMENT:
    case ERROR_CODES.INVALID_REFERENCE:
      return 'invalid-argument'
    case ERROR_CODES.UNAUTHENTICATED:
    case ERROR_CODES.TOKEN_EXPIRED:
    case ERROR_CODES.INVALID_CREDENTIALS:
      return 'unauthenticated'
    case ERROR_CODES.FORBIDDEN:
    case ERROR_CODES.PASSWORD_CHANGE_REQUIRED:
      return 'forbidden'
    case ERROR_CODES.RESOURCE_NOT_FOUND:
      return 'not-found'
    case ERROR_CODES.RESOURCE_CONFLICT:
    case ERROR_CODES.INVALID_STATE_TRANSITION:
    case ERROR_CODES.REFERENCE_IN_USE:
      return 'conflict'
    case ERROR_CODES.RATE_LIMITED:
      return 'rate-limited'
    case ERROR_CODES.DEPENDENCY_UNAVAILABLE:
    case ERROR_CODES.DEPENDENCY_TIMEOUT:
      return 'dependency'
    case ERROR_CODES.INTERNAL_ERROR:
      return 'server'
    default:
      return 'business'
  }
}

function httpStatusToKind(status: number): ApiErrorKind {
  if (status === 400) return 'invalid-argument'
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429) return 'rate-limited'
  if (status === 502 || status === 503) return 'dependency'
  if (status >= 500) return 'server'
  return 'business'
}

/** 各类错误对用户的统一文案（业务错误优先用服务端 message） */
export const KIND_MESSAGES: Readonly<Record<ApiErrorKind, string>> = {
  business: '请求未被接受。',
  'invalid-argument': '请求参数不合法。',
  unauthenticated: '登录状态已失效，请重新登录。',
  forbidden: '当前账号没有访问该功能的权限。',
  'not-found': '请求的资源不存在。',
  conflict: '当前数据状态不允许该操作，请刷新后重试。',
  'rate-limited': '请求过于频繁，请稍后再试。',
  dependency: '依赖服务不可用，请稍后重试。',
  timeout: '请求超时，请稍后重试。',
  network: '无法连接到服务器，请确认后端服务（3001）已启动。',
  server: '服务器内部错误，请稍后重试。',
  canceled: '请求已取消。',
  malformed: '响应格式不符合接口契约。',
  unknown: '发生未知错误，请稍后重试。',
}

interface AxiosLikeError {
  isAxiosError: true
  code?: string
  message?: string
  config?: { method?: string; url?: string }
  response?: {
    status?: number
    data?: unknown
    headers?: Record<string, unknown>
  }
}

function isAxiosLike(value: unknown): value is AxiosLikeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isAxiosError?: unknown }).isAxiosError === true
  )
}

/** 从响应头读取 X-Request-Id（大小写不敏感） */
export function readRequestId(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null
  const record = headers as Record<string, unknown>
  const direct = record['x-request-id'] ?? record['X-Request-Id']
  if (typeof direct === 'string' && direct.length > 0) return direct
  const withGetter = headers as { get?: (name: string) => unknown }
  if (typeof withGetter.get === 'function') {
    const viaGetter = withGetter.get('x-request-id')
    if (typeof viaGetter === 'string' && viaGetter.length > 0) return viaGetter
  }
  return null
}

function extractFieldErrors(data: unknown): FieldError[] {
  if (!data || typeof data !== 'object') return []
  const errors = (data as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []
  return errors
    .filter((item): item is FieldError => {
      return (
        !!item &&
        typeof item === 'object' &&
        typeof (item as FieldError).field === 'string' &&
        typeof (item as FieldError).reason === 'string'
      )
    })
    .map((item) => ({ field: item.field, reason: item.reason }))
}

/** 由契约包体构造业务错误（HTTP 2xx 但 code != 0） */
export function businessErrorFrom(
  body: Pick<ApiResponse<unknown>, 'code' | 'message'> & { data?: unknown },
  httpStatus: number | null,
  requestId: string | null,
): ApiError {
  const kind = codeToKind(body.code)
  const serverMessage = typeof body.message === 'string' && body.message.trim().length > 0 ? body.message : null
  return new ApiError({
    kind,
    // 4xx 业务错误透出服务端中文文案；5xx 使用安全文案（后端已做安全化，前端再兜一层）
    message:
      kind === 'server' || kind === 'dependency'
        ? KIND_MESSAGES[kind]
        : (serverMessage ?? KIND_MESSAGES[kind]),
    code: body.code,
    httpStatus,
    requestId,
    fieldErrors: extractFieldErrors(body.data),
  })
}

/**
 * 把任意异常归一为 `ApiError`。
 * 通过鸭子类型识别 axios 错误，避免本模块依赖 axios 实现细节。
 */
export function toApiError(input: unknown): ApiError {
  if (isApiError(input)) return input

  if (isAxiosLike(input)) {
    const requestId = readRequestId(input.response?.headers)

    if (input.code === 'ERR_CANCELED') {
      return new ApiError({ kind: 'canceled', message: KIND_MESSAGES.canceled, cause: input })
    }
    if (input.code === 'ECONNABORTED' || input.code === 'ETIMEDOUT') {
      return new ApiError({ kind: 'timeout', message: KIND_MESSAGES.timeout, cause: input })
    }
    if (!input.response) {
      return new ApiError({ kind: 'network', message: KIND_MESSAGES.network, cause: input })
    }

    const status = typeof input.response.status === 'number' ? input.response.status : null
    const data = input.response.data

    // 契约包体：先校验完整性，再按业务 code 映射
    const envelopeCheck = checkEnvelope(data)
    if (envelopeCheck.ok) {
      const body = data as { code: number; message: string; data?: unknown }
      if (body.code === 0) {
        // HTTP 为错误状态却回 code=0：协议不一致，按响应格式异常处理
        return malformedError('HTTP 状态与 code=0 不一致', status, requestId, input)
      }
      const mapped = businessErrorFrom(body, status, requestId)
      // 注意：Error.message 不是可枚举属性，不能用对象展开复制，需显式重建
      return new ApiError({
        kind: mapped.kind,
        message: mapped.message,
        code: mapped.code,
        httpStatus: mapped.httpStatus,
        requestId: mapped.requestId,
        fieldErrors: mapped.fieldErrors,
        cause: input,
      })
    }

    const kind = status === null ? 'network' : httpStatusToKind(status)
    return new ApiError({
      kind,
      message: KIND_MESSAGES[kind],
      httpStatus: status,
      requestId,
      cause: input,
    })
  }

  if (input instanceof Error) {
    return new ApiError({ kind: 'unknown', message: KIND_MESSAGES.unknown, cause: input })
  }

  return new ApiError({ kind: 'unknown', message: KIND_MESSAGES.unknown, cause: input })
}

/** 面向界面的错误标题（含参数错误明细拼接） */
export function describeApiError(error: unknown): string {
  const apiError = toApiError(error)
  if (apiError.kind === 'invalid-argument' && apiError.fieldErrors.length > 0) {
    const details = apiError.fieldErrors.map((item) => `${item.field}：${item.reason}`).join('；')
    return `${apiError.message}（${details}）`
  }
  return apiError.message
}
