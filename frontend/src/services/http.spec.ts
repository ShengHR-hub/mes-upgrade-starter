import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  httpClient,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  setAccessTokenProvider,
  setUnauthorizedHandler,
} from './http'

/**
 * 通过替换 axios adapter 走**真实拦截器链**（不是绕过它），
 * 覆盖「不完整包体」「业务失败」「401/403」「写请求不重试」等回归点。
 */
type AdapterResult = { status: number; body: unknown; headers?: Record<string, string> }

let adapterCalls: Array<{ method: string; url: string; headers: Record<string, unknown> }> = []
let nextResult: AdapterResult = { status: 200, body: { code: 0, message: '成功', data: null } }

function installAdapter(): void {
  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    adapterCalls.push({
      method: String(config.method ?? '').toUpperCase(),
      url: String(config.url ?? ''),
      headers: (config.headers ?? {}) as unknown as Record<string, unknown>,
    })
    return {
      data: nextResult.body,
      status: nextResult.status,
      statusText: String(nextResult.status),
      headers: nextResult.headers ?? {},
      config,
    } as AxiosResponse
  }
  // axios 允许在实例级替换 adapter；此处仅用于测试
  ;(httpClient.defaults as { adapter?: unknown }).adapter = adapter
}

beforeEach(() => {
  adapterCalls = []
  nextResult = { status: 200, body: { code: 0, message: '成功', data: null } }
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(null)
  installAdapter()
})

afterEach(() => {
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(null)
})

describe('统一包体校验（回归：不完整响应不得当作成功）', () => {
  it('完整包体且 code=0 → 返回 data', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '101' } } }
    await expect(httpGet<{ id: string }>('/orders/101')).resolves.toEqual({ id: '101' })
  })

  it('data 为 null 是契约允许的成功形态', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: null } }
    await expect(httpDelete<null>('/boms/1')).resolves.toBeNull()
  })

  it('缺 message / data 的包体一律拒绝，不返回 undefined', async () => {
    nextResult = { status: 200, body: { code: 0 } }
    await expect(httpGet('/orders')).rejects.toMatchObject({ kind: 'malformed' })

    nextResult = { status: 200, body: { code: 0, message: '成功' } }
    await expect(httpGet('/orders')).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('字段类型错误一律拒绝', async () => {
    nextResult = { status: 200, body: { code: '0', message: '成功', data: null } }
    await expect(httpGet('/orders')).rejects.toMatchObject({ kind: 'malformed' })

    nextResult = { status: 200, body: { code: 0, message: 123, data: null } }
    await expect(httpGet('/orders')).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('非契约包体（如代理返回 HTML）一律拒绝', async () => {
    nextResult = { status: 200, body: '<html>502 Bad Gateway</html>' }
    await expect(httpGet('/health')).rejects.toMatchObject({ kind: 'malformed' })

    nextResult = { status: 200, body: null }
    await expect(httpGet('/health')).rejects.toMatchObject({ kind: 'malformed' })
  })
})

describe('业务失败（HTTP 200 但 code != 0）', () => {
  it('按业务失败处理并保留字段明细与请求号', async () => {
    nextResult = {
      status: 200,
      body: { code: 10001, message: '参数错误', data: { errors: [{ field: 'qty', reason: '必须为正整数' }] } },
      headers: { 'x-request-id': 'req-abc' },
    }
    await expect(httpGet('/orders', { qty: -1 })).rejects.toMatchObject({
      kind: 'invalid-argument',
      code: 10001,
      requestId: 'req-abc',
      fieldErrors: [{ field: 'qty', reason: '必须为正整数' }],
    })
  })
})

describe('401 / 403 处理', () => {
  it('403 归为无权限，且不触发重新登录', async () => {
    const onUnauthorized = vi.fn()
    setAccessTokenProvider(() => 'token-abc')
    setUnauthorizedHandler(onUnauthorized)

    nextResult = { status: 403, body: { code: 20004, message: '无权限', data: null } }
    await expect(httpGet('/users')).rejects.toMatchObject({ kind: 'forbidden' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('401 归为登录失效并触发一次重新登录', async () => {
    const onUnauthorized = vi.fn()
    setAccessTokenProvider(() => 'token-abc')
    setUnauthorizedHandler(onUnauthorized)

    nextResult = { status: 401, body: { code: 20001, message: '未认证', data: null } }
    await expect(httpGet('/users/me')).rejects.toMatchObject({ kind: 'unauthenticated' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('未持有令牌时 401 不触发重新登录（避免登录页跳转循环）', async () => {
    const onUnauthorized = vi.fn()
    setAccessTokenProvider(() => null)
    setUnauthorizedHandler(onUnauthorized)

    nextResult = { status: 401, body: { code: 20003, message: '用户名或密码错误', data: null } }
    await expect(httpPost('/sessions', { username: 'a', password: 'b' })).rejects.toMatchObject({
      kind: 'unauthenticated',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('写请求不自动重试', () => {
  it('POST 失败只请求一次', async () => {
    nextResult = { status: 500, body: { code: 50001, message: '服务器内部错误', data: null } }
    await expect(httpPost('/orders', { code: 'SO-1' })).rejects.toMatchObject({ kind: 'server' })
    expect(adapterCalls).toHaveLength(1)
  })

  it('PATCH / DELETE 失败同样只请求一次', async () => {
    nextResult = { status: 503, body: { code: 50002, message: '依赖服务不可用', data: null } }
    await expect(httpPatch('/orders/1', { qty: 1 })).rejects.toMatchObject({ kind: 'dependency' })
    await expect(httpDelete('/orders/1')).rejects.toMatchObject({ kind: 'dependency' })
    expect(adapterCalls).toHaveLength(2)
  })

  it('GET 失败也不重试', async () => {
    nextResult = { status: 500, body: { code: 50001, message: 'x', data: null } }
    await expect(httpGet('/orders')).rejects.toBeTruthy()
    expect(adapterCalls).toHaveLength(1)
  })
})

describe('令牌携带', () => {
  it('持有令牌时自动加 Authorization', async () => {
    setAccessTokenProvider(() => 'token-xyz')
    nextResult = { status: 200, body: { code: 0, message: '成功', data: null } }
    await httpGet('/orders')

    const header = adapterCalls[0]?.headers ?? {}
    const value = typeof (header as { get?: (n: string) => unknown }).get === 'function'
      ? (header as { get: (n: string) => unknown }).get('Authorization')
      : (header as Record<string, unknown>).Authorization
    expect(value).toBe('Bearer token-xyz')
  })

  it('无令牌时不带 Authorization', async () => {
    setAccessTokenProvider(() => null)
    nextResult = { status: 200, body: { code: 0, message: '成功', data: null } }
    await httpGet('/health')

    const header = adapterCalls[0]?.headers ?? {}
    const value = typeof (header as { get?: (n: string) => unknown }).get === 'function'
      ? (header as { get: (n: string) => unknown }).get('Authorization')
      : (header as Record<string, unknown>).Authorization
    expect(value).toBeFalsy()
  })
})
