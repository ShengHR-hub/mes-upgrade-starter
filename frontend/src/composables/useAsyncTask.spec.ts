import { effectScope } from 'vue'
import { describe, expect, it } from 'vitest'

import { useAsyncTask, type AsyncTask } from './useAsyncTask'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 构造与 axios 取消错误同形状的异常（`toApiError` 据此识别为 canceled） */
function canceledError(): Error & { isAxiosError: boolean; code: string } {
  const error = new Error('canceled') as Error & { isAxiosError: boolean; code: string }
  error.isAxiosError = true
  error.code = 'ERR_CANCELED'
  return error
}

/** 模拟真实请求：响应 AbortSignal 的中止 */
function abortable<T>(source: Deferred<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(canceledError())
      return
    }
    signal.addEventListener('abort', () => reject(canceledError()), { once: true })
    source.promise.then(resolve, reject)
  })
}

/** 在 effectScope 中创建任务，模拟组件生命周期（onScopeDispose 生效） */
function createTask<T>(): { task: AsyncTask<T>; scope: ReturnType<typeof effectScope> } {
  const scope = effectScope()
  const task = scope.run(() => useAsyncTask<T>()) as AsyncTask<T>
  return { task, scope }
}

const tick = (): Promise<void> => Promise.resolve()

describe('useAsyncTask · 成功与失败', () => {
  it('成功：loading 结束并写入 data', async () => {
    const { task } = createTask<number>()
    const source = deferred<number>()
    const pending = task.run((signal) => abortable(source, signal))
    await tick()
    expect(task.loading.value).toBe(true)

    source.resolve(42)
    await pending

    expect(task.loading.value).toBe(false)
    expect(task.data.value).toBe(42)
    expect(task.error.value).toBeNull()
  })

  it('失败：loading 结束并写入 error', async () => {
    const { task } = createTask<number>()
    const source = deferred<number>()
    const pending = task.run((signal) => abortable(source, signal))
    await tick()

    source.reject(Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 500, data: { code: 50001, message: '服务器内部错误', data: null } } }))
    await pending

    expect(task.loading.value).toBe(false)
    expect(task.error.value?.kind).toBe('server')
    expect(task.data.value).toBeNull()
  })

  it('同步抛错也结束 loading', async () => {
    const { task } = createTask<number>()
    await task.run(() => {
      throw new Error('sync boom')
    })
    expect(task.loading.value).toBe(false)
    expect(task.error.value).not.toBeNull()
  })
})

describe('useAsyncTask · 取消（回归：取消后 loading 必须结束）', () => {
  it('cancel() 后 loading 立即结束，且不写入 data / error', async () => {
    const { task } = createTask<number>()
    const source = deferred<number>()
    const pending = task.run((signal) => abortable(source, signal))
    await tick()
    expect(task.loading.value).toBe(true)

    task.cancel()
    expect(task.loading.value).toBe(false)

    await pending
    expect(task.loading.value).toBe(false)
    expect(task.data.value).toBeNull()
    expect(task.error.value).toBeNull()
  })

  it('底层 Promise 不响应 abort 时，cancel() 也不能让 loading 卡住', async () => {
    const { task } = createTask<number>()
    const source = deferred<number>()
    // 忽略 signal 的任务：中止后不会 reject
    const pending = task.run(() => source.promise)
    await tick()
    expect(task.loading.value).toBe(true)

    task.cancel()
    expect(task.loading.value).toBe(false)

    source.resolve(1)
    await pending
    expect(task.loading.value).toBe(false)
    // 已取消的一轮不得写入数据
    expect(task.data.value).toBeNull()
  })

  it('取消后可以重新发起请求，loading 生命周期正常', async () => {
    const { task } = createTask<number>()
    const first = deferred<number>()
    const pendingFirst = task.run((signal) => abortable(first, signal))
    await tick()
    task.cancel()
    await pendingFirst

    const second = deferred<number>()
    const pendingSecond = task.run((signal) => abortable(second, signal))
    await tick()
    expect(task.loading.value).toBe(true)

    second.resolve(7)
    await pendingSecond
    expect(task.loading.value).toBe(false)
    expect(task.data.value).toBe(7)
  })
})

describe('useAsyncTask · 并发', () => {
  it('新请求取消旧请求，旧请求不得结束新请求的 loading', async () => {
    const { task } = createTask<number>()
    const first = deferred<number>()
    const second = deferred<number>()

    const pendingFirst = task.run((signal) => abortable(first, signal))
    await tick()
    const pendingSecond = task.run((signal) => abortable(second, signal))
    await tick()

    expect(task.loading.value).toBe(true)

    second.resolve(2)
    await pendingSecond
    expect(task.loading.value).toBe(false)
    expect(task.data.value).toBe(2)

    await pendingFirst
    // 旧请求被取消，不得覆盖新结果，也不得再次改动 loading
    expect(task.data.value).toBe(2)
    expect(task.loading.value).toBe(false)
  })

  it('旧请求在取消前已失败，不得写入 error', async () => {
    const { task } = createTask<number>()
    const first = deferred<number>()
    const second = deferred<number>()

    const pendingFirst = task.run((signal) => abortable(first, signal))
    await tick()
    const pendingSecond = task.run((signal) => abortable(second, signal))
    await tick()

    second.resolve(5)
    await pendingSecond

    first.reject(Object.assign(new Error('late'), { isAxiosError: true, response: { status: 500, data: { code: 50001, message: 'x', data: null } } }))
    await pendingFirst

    expect(task.error.value).toBeNull()
    expect(task.data.value).toBe(5)
  })
})

describe('useAsyncTask · 生命周期与重置', () => {
  it('作用域销毁（组件卸载）时自动取消并结束 loading', async () => {
    const { task, scope } = createTask<number>()
    const source = deferred<number>()
    const pending = task.run((signal) => abortable(source, signal))
    await tick()
    expect(task.loading.value).toBe(true)

    scope.stop()
    await pending

    expect(task.loading.value).toBe(false)
    expect(task.data.value).toBeNull()
    expect(task.error.value).toBeNull()
  })

  it('reset 清空状态并取消在途请求', async () => {
    const { task } = createTask<number>()
    const source = deferred<number>()
    const pending = task.run((signal) => abortable(source, signal))
    await tick()

    task.reset()
    expect(task.loading.value).toBe(false)
    expect(task.error.value).toBeNull()
    expect(task.data.value).toBeNull()

    await pending
    expect(task.loading.value).toBe(false)
  })
})
