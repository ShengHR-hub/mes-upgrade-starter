import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '@/types/api'

import {
  businessErrorFrom,
  checkEnvelope,
  describeApiError,
  isContractEnvelope,
  malformedError,
  readRequestId,
  toApiError,
} from './api-error'

/** 构造一个「看起来像 axios 错误」的对象（避免测试依赖 axios 内部结构） */
function axiosError(options: {
  code?: string
  status?: number
  data?: unknown
  headers?: Record<string, unknown>
}) {
  return {
    isAxiosError: true as const,
    code: options.code,
    message: 'mock',
    response:
      options.status === undefined
        ? undefined
        : { status: options.status, data: options.data, headers: options.headers ?? {} },
  }
}

describe('toApiError · HTTP 200 但 code != 0 视为业务失败', () => {
  it('10001 参数错误：透出服务端文案与字段明细', () => {
    const error = toApiError(
      axiosError({
        status: 200,
        data: {
          code: ERROR_CODES.INVALID_ARGUMENT,
          message: '参数错误',
          data: { errors: [{ field: 'qty', reason: '必须为正整数' }] },
        },
        headers: { 'x-request-id': 'req-10001' },
      }),
    )
    expect(error.kind).toBe('invalid-argument')
    expect(error.code).toBe(10001)
    expect(error.httpStatus).toBe(200)
    expect(error.requestId).toBe('req-10001')
    expect(error.fieldErrors).toEqual([{ field: 'qty', reason: '必须为正整数' }])
    expect(describeApiError(error)).toContain('qty：必须为正整数')
  })

  it('30005 缺少前置条件按业务失败处理', () => {
    const error = toApiError(
      axiosError({ status: 200, data: { code: ERROR_CODES.MISSING_PREREQUISITE, message: '缺少工艺明细', data: null } }),
    )
    expect(error.kind).toBe('business')
    expect(error.message).toBe('缺少工艺明细')
  })
})

describe('toApiError · 认证与权限', () => {
  it('401 未认证 → 触发重新登录', () => {
    const error = toApiError(axiosError({ status: 401, data: { code: ERROR_CODES.UNAUTHENTICATED, message: '未认证', data: null } }))
    expect(error.kind).toBe('unauthenticated')
    expect(error.isAuthExpired).toBe(true)
    expect(error.isForbidden).toBe(false)
  })

  it('20003 账号或密码错误也归为未认证（登录页不得跳转循环）', () => {
    const error = toApiError(
      axiosError({ status: 401, data: { code: ERROR_CODES.INVALID_CREDENTIALS, message: '用户名或密码错误', data: null } }),
    )
    expect(error.kind).toBe('unauthenticated')
  })

  it('403 无权限不得伪装成登录失效', () => {
    const error = toApiError(axiosError({ status: 403, data: { code: ERROR_CODES.FORBIDDEN, message: '无权限', data: null } }))
    expect(error.kind).toBe('forbidden')
    expect(error.isForbidden).toBe(true)
    expect(error.isAuthExpired).toBe(false)
  })

  it('20005 首登需改密归为无权限', () => {
    const error = toApiError(
      axiosError({ status: 403, data: { code: ERROR_CODES.PASSWORD_CHANGE_REQUIRED, message: '需先修改密码', data: null } }),
    )
    expect(error.kind).toBe('forbidden')
  })
})

describe('toApiError · 404 / 冲突 / 限流 / 依赖', () => {
  it('404 资源不存在', () => {
    const error = toApiError(axiosError({ status: 404, data: { code: ERROR_CODES.RESOURCE_NOT_FOUND, message: '资源不存在', data: null } }))
    expect(error.kind).toBe('not-found')
  })

  it('409 状态冲突', () => {
    const error = toApiError(
      axiosError({ status: 409, data: { code: ERROR_CODES.INVALID_STATE_TRANSITION, message: '状态条件不满足', data: null } }),
    )
    expect(error.kind).toBe('conflict')
  })

  it('429 限流', () => {
    const error = toApiError(axiosError({ status: 429, data: { code: ERROR_CODES.RATE_LIMITED, message: '请求过于频繁', data: null } }))
    expect(error.kind).toBe('rate-limited')
  })

  it('50002 依赖不可用使用安全文案', () => {
    const error = toApiError(
      axiosError({ status: 503, data: { code: ERROR_CODES.DEPENDENCY_UNAVAILABLE, message: 'stack trace secret', data: null } }),
    )
    expect(error.kind).toBe('dependency')
    expect(error.message).toBe('依赖服务不可用，请稍后重试。')
    expect(error.message).not.toContain('secret')
  })

  it('50001 服务器错误使用安全文案，不泄露原文', () => {
    const error = toApiError(
      axiosError({ status: 500, data: { code: ERROR_CODES.INTERNAL_ERROR, message: 'SQL syntax error near secret_table', data: null } }),
    )
    expect(error.kind).toBe('server')
    expect(error.message).toBe('服务器内部错误，请稍后重试。')
    expect(error.message).not.toContain('secret_table')
  })

  it('无契约包体时按 HTTP 状态兜底', () => {
    const error = toApiError(axiosError({ status: 404, data: '<html>nginx 404</html>' }))
    expect(error.kind).toBe('not-found')
    expect(error.code).toBeNull()
  })
})

describe('toApiError · 网络与超时', () => {
  it('超时（ECONNABORTED）', () => {
    expect(toApiError(axiosError({ code: 'ECONNABORTED' })).kind).toBe('timeout')
    expect(toApiError(axiosError({ code: 'ETIMEDOUT' })).kind).toBe('timeout')
  })

  it('504 归为超时', () => {
    expect(toApiError(axiosError({ status: 504, data: { code: 50003, message: '超时', data: null } })).kind).toBe('dependency')
    expect(toApiError(axiosError({ status: 504, data: 'gateway timeout' })).kind).toBe('timeout')
  })

  it('无响应（后端未启动）归为网络错误', () => {
    const error = toApiError(axiosError({}))
    expect(error.kind).toBe('network')
    expect(error.message).toContain('3001')
  })

  it('主动取消', () => {
    expect(toApiError(axiosError({ code: 'ERR_CANCELED' })).kind).toBe('canceled')
  })

  it('未知异常不抛出、不泄露原文', () => {
    const error = toApiError(new Error('internal detail'))
    expect(error.kind).toBe('unknown')
    expect(error.message).not.toContain('internal detail')
  })
})

describe('readRequestId', () => {
  it('支持小写 / 大写 / AxiosHeaders.get', () => {
    expect(readRequestId({ 'x-request-id': 'a' })).toBe('a')
    expect(readRequestId({ 'X-Request-Id': 'b' })).toBe('b')
    expect(readRequestId({ get: (name: string) => (name === 'x-request-id' ? 'c' : undefined) })).toBe('c')
    expect(readRequestId({})).toBeNull()
    expect(readRequestId(undefined)).toBeNull()
  })
})

describe('businessErrorFrom', () => {
  it('未知业务码归为 business 并透出服务端文案', () => {
    const error = businessErrorFrom({ code: 99999, message: '自定义业务失败', data: null }, 400, null)
    expect(error.kind).toBe('business')
    expect(error.message).toBe('自定义业务失败')
    expect(error.code).toBe(99999)
  })

  it('服务端无文案时使用兜底文案', () => {
    const error = businessErrorFrom({ code: 99999, message: '', data: null }, 400, null)
    expect(error.message).toBe('请求未被接受。')
  })
})

describe('checkEnvelope · 统一包体完整性（审查修复 · 第一轮）', () => {
  it('完整包体通过（data 可为 null）', () => {
    expect(checkEnvelope({ code: 0, message: '成功', data: null }).ok).toBe(true)
    expect(checkEnvelope({ code: 0, message: '成功', data: { id: '1' } }).ok).toBe(true)
    expect(checkEnvelope({ code: 10001, message: '参数错误', data: { errors: [] } }).ok).toBe(true)
  })

  it('缺少 message 或 data 一律不通过', () => {
    expect(checkEnvelope({ code: 0 })).toEqual({ ok: false, reason: '缺少字符串类型的 message 字段' })
    expect(checkEnvelope({ code: 0, message: '成功' })).toEqual({
      ok: false,
      reason: '缺少 data 字段（契约要求始终存在，可为 null）',
    })
  })

  it('code 非有限数字不通过', () => {
    expect(checkEnvelope({ code: '0', message: '成功', data: null }).ok).toBe(false)
    expect(checkEnvelope({ message: '成功', data: null }).ok).toBe(false)
    expect(checkEnvelope({ code: Number.NaN, message: '成功', data: null }).ok).toBe(false)
    expect(checkEnvelope({ code: Number.POSITIVE_INFINITY, message: '成功', data: null }).ok).toBe(false)
  })

  it('message 非字符串不通过', () => {
    expect(checkEnvelope({ code: 0, message: 123, data: null }).ok).toBe(false)
    expect(checkEnvelope({ code: 0, message: null, data: null }).ok).toBe(false)
  })

  it('非对象一律不通过', () => {
    expect(checkEnvelope(null).ok).toBe(false)
    expect(checkEnvelope('<html>502</html>').ok).toBe(false)
    expect(checkEnvelope([{ code: 0, message: '成功', data: null }]).ok).toBe(false)
    expect(checkEnvelope(undefined).ok).toBe(false)
  })

  it('isContractEnvelope 作为类型守卫', () => {
    expect(isContractEnvelope({ code: 0, message: '成功', data: null })).toBe(true)
    expect(isContractEnvelope({ code: 0 })).toBe(false)
  })

  it('malformedError 不泄露原文、保留请求号', () => {
    const error = malformedError('缺少 data 字段（契约要求始终存在，可为 null）', 200, 'req-x')
    expect(error.kind).toBe('malformed')
    expect(error.requestId).toBe('req-x')
    expect(error.httpStatus).toBe(200)
    expect(error.message).toContain('响应格式不符合接口契约')
  })
})

describe('toApiError · 不完整包体在错误分支也不误判', () => {
  it('HTTP 错误状态 + 非完整包体 → 按 HTTP 状态兜底（502 → dependency）', () => {
    const error = toApiError(axiosError({ status: 502, data: { code: 0, message: '成功' } }))
    expect(error.kind).toBe('dependency')
    expect(error.code).toBeNull()
  })

  it('HTTP 错误状态却回 code=0（完整包体）→ malformed', () => {
    const error = toApiError(axiosError({ status: 500, data: { code: 0, message: '成功', data: null } }))
    expect(error.kind).toBe('malformed')
  })

  it('完整包体仍按业务码映射（不因新增校验而回归）', () => {
    const error = toApiError(axiosError({ status: 404, data: { code: ERROR_CODES.RESOURCE_NOT_FOUND, message: '资源不存在', data: null } }))
    expect(error.kind).toBe('not-found')
    expect(error.code).toBe(30001)
  })
})
