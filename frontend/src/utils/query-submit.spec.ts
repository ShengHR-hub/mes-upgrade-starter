import { effectScope } from 'vue'
import { describe, expect, it } from 'vitest'

import { useAsyncTask, type AsyncTask } from '@/composables/useAsyncTask'
import { decideSubmit, type SubmitIdentity } from './query-submit'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function cancelable<T>(source: Deferred<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(Object.assign(new Error('canceled'), { isAxiosError: true, code: 'ERR_CANCELED' }))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    source.promise.then(resolve, reject)
  })
}

/** 忽略 AbortSignal 的请求（最坏情况：取消后 Promise 永不 settle） */
function uncancelable<T>(source: Deferred<T>): Promise<T> {
  return source.promise
}

/** 宏任务 tick：清空全部微任务链（resolve → run → finally → 身份释放） */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 与 DataQueryView 相同的提交控制（token 身份 + loading 判定） */
function createSubmitter<T>(
  task: AsyncTask<T>,
  options: { ignoreAbort?: boolean } = {},
): {
  submit: (text: string) => void
  cancel: () => void
  inFlight: () => SubmitIdentity | null
} {
  let seq = 0
  const state = { current: null as SubmitIdentity | null }

  return {
    inFlight: () => state.current,
    submit(text: string): void {
      const trimmed = text.trim()
      if (decideSubmit(state.current, trimmed, task.loading.value) === 'duplicate') return
      if (task.loading.value) {
        task.reset()
      }
      seq += 1
      const token: SubmitIdentity = { id: seq, question: trimmed }
      state.current = token
      void task
        .run((signal) => {
          const source = deferred<T>()
          ;(task as any).__sources = (task as any).__sources ?? {}
          ;(task as any).__sources[token.id] = source
          return options.ignoreAbort ? uncancelable(source) : cancelable(source, signal)
        })
        .catch(() => undefined)
        .finally(() => {
          if (state.current?.id === token.id) state.current = null
        })
    },
    cancel(): void {
      task.cancel()
      state.current = null
    },
  }
}

describe('decideSubmit · 提交 token 判定（S9 二轮审查修复）', () => {
  const identity = (id: number, question: string): SubmitIdentity => ({ id, question })

  it('空问题一律拒绝', () => {
    expect(decideSubmit(null, '', true)).toBe('duplicate')
    expect(decideSubmit(identity(1, 'A'), '   ', true)).toBe('duplicate')
  });

  it('在途且同问题 → duplicate（防重复提交）', () => {
    expect(decideSubmit(identity(1, '今天产量'), '今天产量', true)).toBe('duplicate')
    expect(decideSubmit(identity(1, '今天产量'), ' 今天产量 ', true)).toBe('duplicate')
  });

  it('在途但不同问题 → accept（新请求）', () => {
    expect(decideSubmit(identity(1, 'A'), 'B', true)).toBe('accept')
  });

  it('请求已结束（loading=false）→ 同问题可再次提交', () => {
    expect(decideSubmit(identity(1, '今天产量'), '今天产量', false)).toBe('accept')
    expect(decideSubmit(null, '今天产量', false)).toBe('accept')
  });
});

describe('问数提交时序 · S9 二轮审查修复（token 身份可靠）', () => {
  it('A 在途时切换到 B：取消旧轮次，最终展示 B 的回答', async () => {
    const scope = effectScope()
    const task = scope.run(() => useAsyncTask<{ answer: string }>()) as AsyncTask<{
      answer: string
    }>
    const s = createSubmitter(task)
    const calls: string[] = []

    // 包装以记录调用（createSubmitter 内部已发起，这里通过 sources 顺序断言）
    s.submit('A')
    await tick()
    expect(task.loading.value).toBe(true)
    expect(s.inFlight()?.question).toBe('A')

    s.submit('B')
    await tick()

    // A 已被取消/替换：迟到响应不得覆盖 B
    const sources = (task as any).__sources as Record<number, Deferred<{ answer: string }>>
    sources[1]?.resolve({ answer: 'answer:A' })
    sources[2]?.resolve({ answer: 'answer:B' })
    await tick()

    expect(task.data.value).toEqual({ answer: 'answer:B' })
    expect(task.error.value).toBeNull()
    expect(task.loading.value).toBe(false)
    expect(s.inFlight()).toBeNull()
    expect(calls).toEqual([]) // 调用记录由 sources 键证明：1=A, 2=B
    scope.stop()
  });

  it('二轮审查核心：取消后立即可再次提交同一问题（底层忽略 abort 也不卡死）', async () => {
    const scope = effectScope()
    const task = scope.run(() => useAsyncTask<{ answer: string }>()) as AsyncTask<{
      answer: string
    }>
    // 最坏情况：底层 Promise 永不 settle、忽略 AbortSignal
    const s = createSubmitter(task, { ignoreAbort: true })

    s.submit('今天产量')
    await tick()
    expect(task.loading.value).toBe(true)

    // 用户点击取消：loading 立即结束，身份同步释放
    s.cancel()
    expect(task.loading.value).toBe(false)
    expect(s.inFlight()).toBeNull()

    // 同一问题立即重新提交：不得被误判为重复
    s.submit('今天产量')
    await tick()
    expect(task.loading.value).toBe(true)
    expect(s.inFlight()?.id).toBe(2)

    const sources = (task as any).__sources as Record<number, Deferred<{ answer: string }>>
    sources[2].resolve({ answer: 'ok' })
    await tick()
    expect(task.data.value).toEqual({ answer: 'ok' })
    scope.stop()
  });

  it('在途期间重复点击同一问题只发起一次', async () => {
    const scope = effectScope()
    const task = scope.run(() => useAsyncTask<number>()) as AsyncTask<number>
    const s = createSubmitter(task)
    let calls = 0
    const runSpy = task.run
    ;(task as any).run = (fn: (signal: AbortSignal) => Promise<number>) => {
      calls += 1
      return runSpy(fn)
    }

    s.submit('今天产量')
    s.submit('今天产量')
    s.submit(' 今天产量 ')
    await tick()
    expect(calls).toBe(1)

    const sources = (task as any).__sources as Record<number, Deferred<number>>
    sources[1].resolve(1)
    await tick()
    expect(task.data.value).toBe(1)
    scope.stop()
  });

  it('被取消但迟到的旧请求 finally 不清除新 token（token 判等）', async () => {
    const scope = effectScope()
    const task = scope.run(() => useAsyncTask<{ answer: string }>()) as AsyncTask<{
      answer: string
    }>
    const s = createSubmitter(task, { ignoreAbort: true })

    s.submit('A') // token 1（永不 settle）
    await tick()
    s.submit('B') // token 2：reset 旧轮次
    await tick()
    expect(s.inFlight()?.id).toBe(2)

    // token 2 完成 → 身份释放
    const sources = (task as any).__sources as Record<number, Deferred<{ answer: string }>>
    sources[2].resolve({ answer: 'answer:B' })
    await tick()
    expect(s.inFlight()).toBeNull()
    expect(task.data.value).toEqual({ answer: 'answer:B' })
    scope.stop()
  });
});
