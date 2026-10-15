import { describe, expect, it, vi } from 'vitest'

import { useSubmitGuard } from './useSubmitGuard'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useSubmitGuard —— 重复提交保护（S5 审查意见回归）', () => {
  it('**并发调用只执行一次**（这是被修复的缺陷：锁必须同步获取）', async () => {
    const guard = useSubmitGuard()
    const gate = deferred()
    const task = vi.fn(async () => {
      await gate.promise
      return 'done'
    })

    // 模拟"快速双击 / 连按回车"：两次调用在同一 tick 内发出
    const first = guard.run(task)
    const second = guard.run(task)

    expect(task).toHaveBeenCalledTimes(1) // 第二次必须在加锁处被挡下
    expect(guard.submitting.value).toBe(true)

    gate.resolve()
    await expect(first).resolves.toBe('done')
    await expect(second).resolves.toBeUndefined()
    expect(task).toHaveBeenCalledTimes(1)
    expect(guard.submitting.value).toBe(false)
  })

  it('三次并发同样只执行一次', async () => {
    const guard = useSubmitGuard()
    const gate = deferred()
    const task = vi.fn(async () => {
      await gate.promise
    })

    const all = [guard.run(task), guard.run(task), guard.run(task)]
    expect(task).toHaveBeenCalledTimes(1)

    gate.resolve()
    await Promise.all(all)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('上一轮结束后可以再次提交（锁不会永久卡住）', async () => {
    const guard = useSubmitGuard()
    const task = vi.fn(async () => 'ok')

    await expect(guard.run(task)).resolves.toBe('ok')
    expect(guard.submitting.value).toBe(false)

    await expect(guard.run(task)).resolves.toBe('ok')
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('任务抛错时同样解锁（失败不会把界面锁死）', async () => {
    const guard = useSubmitGuard()
    const task = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(guard.run(task)).rejects.toThrow('boom')
    expect(guard.submitting.value).toBe(false)

    // 解锁后可以重试
    await expect(guard.run(async () => 'retry')).resolves.toBe('retry')
  })

  it('任务内部的 await 不会让并发的第二次调用漏进来', async () => {
    const guard = useSubmitGuard()
    const task = vi.fn(async () => {
      // 模拟表单校验 / 网络请求
      await new Promise((resolve) => setTimeout(resolve, 5))
      return 'ok'
    })

    const [a, b] = await Promise.all([guard.run(task), guard.run(task)])
    expect(task).toHaveBeenCalledTimes(1)
    expect(a).toBe('ok')
    expect(b).toBeUndefined()
  })
})
