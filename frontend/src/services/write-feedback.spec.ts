import { describe, expect, it, vi } from 'vitest'

// `write-feedback` 会引入 element-plus 的 ElMessage；本测试只关心分类逻辑，
// 因此替换掉 UI 依赖，避免在 node 环境加载组件库。
vi.mock('element-plus', () => ({ ElMessage: vi.fn() }))

import { ApiError } from './api-error'
import { isResultUnconfirmed, UNCONFIRMED_RESULT_TEXT } from './write-feedback'

/**
 * 写请求失败的分类（S5 交互要求第 3 条）。
 *
 * 超时 / 断网 / 依赖不可用这三类**无法从前端判定服务端是否已提交**，
 * 因此必须提示「结果未确认，请查询核对」，且不得自动重发。
 * 其余错误（400 / 403 / 409 / 422）则按普通业务失败提示。
 */
describe('isResultUnconfirmed —— 只有"结果可能已生效但无法确认"的错误才算未确认', () => {
  it('超时 / 断网 / 依赖不可用 → 未确认', () => {
    expect(isResultUnconfirmed(new ApiError({ kind: 'timeout', message: 't' }))).toBe(true)
    expect(isResultUnconfirmed(new ApiError({ kind: 'network', message: 'n' }))).toBe(true)
    expect(isResultUnconfirmed(new ApiError({ kind: 'dependency', message: 'd' }))).toBe(true)
  })

  it('参数错误 / 无权限 / 冲突 / 业务失败 → 不算未确认', () => {
    for (const kind of ['invalid-argument', 'forbidden', 'conflict', 'business', 'not-found'] as const) {
      expect(isResultUnconfirmed(new ApiError({ kind, message: 'x' })), kind).toBe(false)
    }
  })

  it('401（登录失效）不算未确认，交由重新登录流程处理', () => {
    expect(isResultUnconfirmed(new ApiError({ kind: 'unauthenticated', message: 'x' }))).toBe(false)
  })

  it('文案明确要求用户核对，且不承诺已成功或已失败', () => {
    expect(UNCONFIRMED_RESULT_TEXT).toBe('结果未确认，请查询核对。')
  })
})
