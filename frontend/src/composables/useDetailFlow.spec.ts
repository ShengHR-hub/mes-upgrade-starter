import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useDetailFlow } from './useDetailFlow'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * 回归背景（S5 审查 P2：「旧详情流程覆盖新对象的关联数据」）。
 *
 * 场景：先请求 A，再请求 B；B 完成后，A 的详情请求被取消并结束，
 * 但**旧实现仍会无条件启动 A 的关联查询**，最终界面呈现「B 的详情 + A 的关联数据」。
 */
describe('useDetailFlow —— 轮次隔离（S5 审查 P2 回归）', () => {
  it('**旧轮次的关联查询不得覆盖新对象**（核心回归）', async () => {
    const detailA = deferred<{ id: string }>()
    const detailB = deferred<{ id: string }>()
    const fetchRelated = vi.fn(async (id: string) => `${id}-related`)

    const flow = useDetailFlow<{ id: string }, string>({
      fetchDetail: (id) => (id === 'A' ? detailA.promise : detailB.promise),
      fetchRelated,
    })

    const runA = flow.run('A')
    const runB = flow.run('B')

    // B 先完成
    detailB.resolve({ id: 'B' })
    await runB
    expect(flow.detail.value).toEqual({ id: 'B' })
    expect(flow.related.value).toBe('B-related')

    // A 的详情请求随后才结束 —— 必须被丢弃，且**不得**启动 A 的关联查询
    detailA.resolve({ id: 'A' })
    await runA

    expect(flow.detail.value).toEqual({ id: 'B' }) // 详情仍是 B
    expect(flow.related.value).toBe('B-related') // 关联也仍是 B（修复前会变成 A-related）
    expect(fetchRelated).toHaveBeenCalledTimes(1)
    expect(fetchRelated).toHaveBeenCalledWith('B', expect.anything())
    expect(flow.loading.value).toBe(false)
  })

  it('切换对象时立即清空上一对象的数据（不残留旧关联）', async () => {
    const detailA = deferred<{ id: string }>()
    const flow = useDetailFlow<{ id: string }, string>({
      fetchDetail: () => detailA.promise,
      fetchRelated: async (id) => `${id}-related`,
    })

    detailA.resolve({ id: 'A' })
    await flow.run('A')
    expect(flow.related.value).toBe('A-related')

    const detailB = deferred<{ id: string }>()
    const flow2 = useDetailFlow<{ id: string }, string>({
      fetchDetail: (id) => (id === 'B' ? detailB.promise : Promise.resolve({ id })),
      fetchRelated: async (id) => `${id}-related`,
    })
    detailB.resolve({ id: 'B' })
    await flow2.run('B')
    expect(flow2.related.value).toBe('B-related')
  })

  it('正常单轮：详情与关联都写入', async () => {
    const flow = useDetailFlow<{ id: string }, string>({
      fetchDetail: async (id) => ({ id }),
      fetchRelated: async (id) => `${id}-related`,
    })

    await flow.run('X')
    expect(flow.detail.value).toEqual({ id: 'X' })
    expect(flow.related.value).toBe('X-related')
    expect(flow.loading.value).toBe(false)
    expect(flow.error.value).toBeNull()
  })

  it('详情失败：记录错误、结束 loading，且不发起关联查询', async () => {
    const fetchRelated = vi.fn(async (id: string) => `${id}-related`)
    const flow = useDetailFlow<{ id: string }, string>({
      fetchDetail: async () => {
        throw new Error('boom')
      },
      fetchRelated,
    })

    await flow.run('X')
    expect(flow.error.value).not.toBeNull()
    expect(flow.loading.value).toBe(false)
    expect(fetchRelated).not.toHaveBeenCalled()
  })

  it('reset() 后旧轮次不得再写入 data / error，且 loading 结束', async () => {
    const pending = deferred<{ id: string }>()
    const flow = useDetailFlow<{ id: string }, string>({
      fetchDetail: () => pending.promise,
      fetchRelated: async (id) => `${id}-related`,
    })

    const running = flow.run('A')
    flow.reset()
    expect(flow.loading.value).toBe(false)

    pending.resolve({ id: 'A' })
    await running

    expect(flow.detail.value).toBeNull()
    expect(flow.related.value).toBeNull()
    expect(flow.error.value).toBeNull()
  })

  it('新一轮开始后，旧轮次的失败不得污染新轮次', async () => {
    const slowFail = deferred<{ id: string }>()
    const flow = useDetailFlow<{ id: string }, string>({
      fetchDetail: (id) => (id === 'A' ? slowFail.promise : Promise.resolve({ id })),
      fetchRelated: async (id) => `${id}-related`,
    })

    const runA = flow.run('A')
    await flow.run('B')

    slowFail.reject(new Error('old failure'))
    await runA

    expect(flow.error.value).toBeNull()
    expect(flow.detail.value).toEqual({ id: 'B' })
    expect(flow.related.value).toBe('B-related')
  })
})

describe('useDetailFlow —— 作用域卸载清理（S5 审查 P2 回归）', () => {
  /**
   * 审查意见：缺少作用域卸载清理 —— 页面卸载后请求不取消、loading 不立即结束，
   * 旧请求返回后仍会启动关联查询并写入状态。
   */
  it('**作用域销毁后：loading 立即结束、旧请求不启动关联查询、不写入状态**', async () => {
    const pending = deferred<{ id: string }>()
    const fetchRelated = vi.fn(async (id: string) => `${id}-related`)

    const scope = effectScope()
    let flow!: ReturnType<typeof useDetailFlow<{ id: string }, string>>
    scope.run(() => {
      flow = useDetailFlow<{ id: string }, string>({
        fetchDetail: () => pending.promise,
        fetchRelated,
      })
    })

    const running = flow.run('A')
    expect(flow.loading.value).toBe(true)

    // 模拟组件卸载
    scope.stop()
    expect(flow.loading.value).toBe(false) // 立即结束，不等底层 Promise

    pending.resolve({ id: 'A' })
    await running

    expect(flow.detail.value).toBeNull()
    expect(flow.related.value).toBeNull()
    expect(flow.error.value).toBeNull()
    expect(fetchRelated).not.toHaveBeenCalled() // 旧请求不得再启动关联查询
  })

  it('卸载后到达的失败也不写入 error', async () => {
    const pending = deferred<{ id: string }>()

    const scope = effectScope()
    let flow!: ReturnType<typeof useDetailFlow<{ id: string }, string>>
    scope.run(() => {
      flow = useDetailFlow<{ id: string }, string>({
        fetchDetail: () => pending.promise,
        fetchRelated: async (id) => `${id}-related`,
      })
    })

    const running = flow.run('A')
    scope.stop()

    pending.reject(new Error('late failure'))
    await running

    expect(flow.error.value).toBeNull()
    expect(flow.loading.value).toBe(false)
  })
})
