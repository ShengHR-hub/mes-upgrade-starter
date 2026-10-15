import { describe, expect, it, vi } from 'vitest'

import { useWorkOrderIndex, type WorkOrderIndexPage } from './useWorkOrderIndex'

/** 手写 deferred：控制每页请求的完成时机 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function page(list: Array<{ saleOrderId?: string | null }>, total = list.length): WorkOrderIndexPage {
  return { list, total }
}

describe('useWorkOrderIndex', () => {
  it('分页拉全后索引完整；已知/未知判定正确', async () => {
    const fetchPage = vi
      .fn<(page: number, pageSize: number) => Promise<WorkOrderIndexPage>>()
      .mockResolvedValueOnce(page([{ saleOrderId: '1' }, { saleOrderId: '2' }], 3))
      .mockResolvedValueOnce(page([{ saleOrderId: '3' }], 3))

    const index = useWorkOrderIndex({ fetchPage, pageSize: 2 })
    await index.load()

    expect(index.hasWorkOrderOf('1')).toBe(true)
    expect(index.hasWorkOrderOf('3')).toBe(true)
    expect(index.hasWorkOrderOf('9')).toBe(false) // 索引完整 → 确知无工单
  })

  it('查询失败 → 索引不完整，未收录的订单判为「未知」', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('boom'))
    const index = useWorkOrderIndex({ fetchPage })
    await index.load()

    expect(index.hasWorkOrderOf('1')).toBeNull()
  })

  it('**刷新（invalidate）立即失效旧索引**：等待新索引期间判为「未知」', async () => {
    // 审查第四轮 P2 复现场景：旧索引 complete=true，刷新开始后、新索引就绪前，
    // hasWorkOrderOf 必须返回 null（按钮隐藏），不得沿用旧判定。
    const gate = deferred<WorkOrderIndexPage>()
    const fetchPage = vi.fn().mockReturnValue(gate.promise)
    const index = useWorkOrderIndex({ fetchPage })

    const loading = index.load()
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
    // 让第一轮先完成：旧索引里已有 id=1
    gate.resolve(page([{ saleOrderId: '1' }]))
    await loading
    expect(index.hasWorkOrderOf('1')).toBe(true)

    // 新一轮刷新：invalidate 后立即查 → 未知（即使 fetch 尚未完成）
    index.invalidate()
    expect(index.hasWorkOrderOf('1')).toBeNull()
    expect(index.hasWorkOrderOf('9')).toBeNull()
  })

  it('**并发刷新隔离**：慢的旧轮次完成后不得覆盖新轮次的结果', async () => {
    // 审查第四轮 P2 复现场景：A 慢、B 快；A 迟到写入必须被丢弃。
    const slowGate = deferred<WorkOrderIndexPage>()
    const fetchPage = vi
      .fn<(page: number, pageSize: number) => Promise<WorkOrderIndexPage>>()
      .mockReturnValueOnce(slowGate.promise) // 轮次 A：慢
      .mockResolvedValue(page([{ saleOrderId: 'B-1' }])) // 轮次 B：快

    const index = useWorkOrderIndex({ fetchPage })
    const runA = index.load()
    const runB = index.load() // B 立即取代 A
    await runB
    expect(index.hasWorkOrderOf('B-1')).toBe(true)

    // A 此刻才完成：写入必须被丢弃
    slowGate.resolve(page([{ saleOrderId: 'A-STALE' }]))
    await runA
    expect(index.state.value.ids.has('A-STALE')).toBe(false)
    expect(index.hasWorkOrderOf('B-1')).toBe(true)
  })

  it('markEmptyComplete 同样使在途轮次作废', async () => {
    const gate = deferred<WorkOrderIndexPage>()
    const fetchPage = vi.fn().mockReturnValue(gate.promise)
    const index = useWorkOrderIndex({ fetchPage })

    const loading = index.load()
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
    index.markEmptyComplete()
    gate.resolve(page([{ saleOrderId: 'LATE' }]))
    await loading

    expect(index.state.value.ids.has('LATE')).toBe(false)
    expect(index.hasWorkOrderOf('LATE')).toBe(false) // complete=true 的空索引
  })
})
