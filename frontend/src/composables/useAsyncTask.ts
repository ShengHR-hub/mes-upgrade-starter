/**
 * 异步任务封装：loading / error / data + 取消。
 *
 * 关键约束（S4 要求第 5 条）：
 * - 无论成功、业务失败、网络失败、超时还是取消，`loading` 都必须结束；
 * - 组件卸载时自动取消在途请求；
 * - 不做任何自动重试。
 *
 * 取消语义（审查修复 · 第一轮 2026-10-10）：
 * - `cancel()` 必须**立即**结束 `loading`，不能依赖底层 Promise 是否会因 abort 而 reject；
 * - 已取消 / 已被新一轮取代的任务，**不得**再写入 `data` 或 `error`；
 * - 并发时只有「当前活跃的那一轮」能改动 `loading`。
 *
 * 实现要点：用 `activeRun` 对象（而非 controller 本身）作为「本轮身份」。
 * 初版在 `cancel()` 中把 controller 置空，使 `finally` 的 `controller === current`
 * 恒为 false → `loading` 永久卡住（回归测试：`useAsyncTask.spec.ts` 取消用例）。
 */

import { onScopeDispose, ref, shallowRef, type Ref } from 'vue'

import { toApiError, type ApiError } from '@/services/api-error'

export interface AsyncTask<T> {
  loading: Ref<boolean>
  error: Ref<ApiError | null>
  data: Ref<T | null>
  run: (task: (signal: AbortSignal) => Promise<T>) => Promise<T | null>
  cancel: () => void
  reset: () => void
}

interface ActiveRun {
  controller: AbortController
}

export function useAsyncTask<T>(): AsyncTask<T> {
  const loading = ref(false)
  const error = shallowRef<ApiError | null>(null)
  const data = shallowRef<T | null>(null)

  let activeRun: ActiveRun | null = null

  /** 仅当传入的 run 仍是当前活跃轮次时，才结束 loading */
  function endRun(run: ActiveRun): void {
    if (activeRun !== run) return
    activeRun = null
    loading.value = false
  }

  /** 本轮是否仍然有效（未被取消，也未被新一轮取代） */
  function isCurrentRun(run: ActiveRun): boolean {
    return activeRun === run && !run.controller.signal.aborted
  }

  async function run(task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    // 取消上一轮；上一轮的 finally 会自行收尾（其身份已被替换，不会误改 loading）
    activeRun?.controller.abort()

    const current: ActiveRun = { controller: new AbortController() }
    activeRun = current
    loading.value = true
    error.value = null

    try {
      const result = await task(current.controller.signal)
      if (!isCurrentRun(current)) return null
      data.value = result
      return result
    } catch (caught) {
      const apiError = toApiError(caught)
      // 取消、或已被新一轮取代：不写入 error
      if (apiError.kind === 'canceled' || !isCurrentRun(current)) return null
      error.value = apiError
      return null
    } finally {
      // 无论成功、失败、取消都尝试收尾；只有仍是当前轮次才会真正结束 loading
      endRun(current)
    }
  }

  function cancel(): void {
    const current = activeRun
    if (!current) return
    current.controller.abort()
    // 立即结束 loading：即使底层 Promise 忽略 signal（永不 settle）也不会卡住界面
    endRun(current)
  }

  function reset(): void {
    const current = activeRun
    if (current) current.controller.abort()
    activeRun = null
    loading.value = false
    error.value = null
    data.value = null
  }

  onScopeDispose(() => {
    const current = activeRun
    if (current) current.controller.abort()
    activeRun = null
    loading.value = false
  })

  return { loading, error, data, run, cancel, reset }
}
