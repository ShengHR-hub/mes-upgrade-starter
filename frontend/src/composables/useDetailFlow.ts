/**
 * 详情流程：主对象 + 关联数据，带**轮次标识**与取消。
 *
 * 背景（S5 审查 P2：「旧详情流程覆盖新对象的关联数据」）：
 * 初版把详情与关联数据拆成两个独立的 `useAsyncTask`，顺序写成
 *
 * ```ts
 * const detail = await detailTask.run(() => fetchDetail(id))   // ← 可能被下一轮取消
 * if (detail) target = detail
 * await relatedTask.run(() => fetchRelated(id))                // ← 无条件继续执行！
 * ```
 *
 * 于是「先点 A、再点 B」时：B 会取消 A 的详情请求，但 **A 的续行代码仍会启动 A 的关联查询**，
 * 把 B 的关联数据覆盖成 A 的（详情显示 B、关联显示 A），可能误导后续操作。
 *
 * 本组合式函数用一个自增 **token** 标识「当前轮次」：
 * - 每轮 `run(id)` 都会 `++token` 并取消上一轮的请求；
 * - **每个 await 之后**都校验 token，已被取代的轮次立即返回，**不再启动后续查询**；
 * - 进入新一轮时立即清空 `detail` / `related`，避免旧数据残留在界面上。
 *
 * 纯逻辑、无 DOM 依赖，可直接单测（见 `useDetailFlow.spec.ts`）。
 */

import { onScopeDispose, ref, type Ref } from 'vue'

import { toApiError, type ApiError } from '@/services/api-error'

export interface DetailFlow<TDetail, TRelated> {
  detail: Ref<TDetail | null>
  related: Ref<TRelated | null>
  loading: Ref<boolean>
  error: Ref<ApiError | null>
  /** 加载指定对象；重复调用时后一次胜出，前一次的后续步骤会被丢弃 */
  run: (id: string) => Promise<void>
  reset: () => void
}

export interface DetailFlowConfig<TDetail, TRelated> {
  fetchDetail: (id: string, signal: AbortSignal) => Promise<TDetail>
  fetchRelated: (id: string, signal: AbortSignal) => Promise<TRelated>
}

export function useDetailFlow<TDetail, TRelated>(
  config: DetailFlowConfig<TDetail, TRelated>,
): DetailFlow<TDetail, TRelated> {
  const detail = ref<TDetail | null>(null) as Ref<TDetail | null>
  const related = ref<TRelated | null>(null) as Ref<TRelated | null>
  const loading = ref(false)
  const error = ref<ApiError | null>(null) as Ref<ApiError | null>

  /** 当前轮次标识；每轮自增，用于丢弃过期轮次的写入 */
  let activeToken = 0
  let controller: AbortController | null = null

  async function run(id: string): Promise<void> {
    const token = ++activeToken
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller

    loading.value = true
    error.value = null
    // 立即清空旧对象的数据，避免"新详情 + 旧关联"的错配画面
    detail.value = null
    related.value = null

    try {
      const loadedDetail = await config.fetchDetail(id, signal)
      // ⚠️ 关键：被新一轮取代时必须**停止**，不能继续发起关联查询
      if (token !== activeToken) return
      detail.value = loadedDetail

      const loadedRelated = await config.fetchRelated(id, signal)
      if (token !== activeToken) return
      related.value = loadedRelated
    } catch (caught) {
      if (token !== activeToken) return
      const apiError = toApiError(caught)
      if (apiError.kind === 'canceled') return
      error.value = apiError
    } finally {
      // 只有仍是当前轮次才结束 loading，避免旧轮次把新轮次的 loading 提前关掉
      if (token === activeToken) loading.value = false
    }
  }

  function reset(): void {
    activeToken += 1
    controller?.abort()
    controller = null
    loading.value = false
    error.value = null
    detail.value = null
    related.value = null
  }

  /**
   * 作用域卸载清理（审查 P2：「缺少作用域卸载清理」）。
   *
   * 组件卸载后必须：取消在途请求、**立即结束 loading**、并让旧请求的返回结果失效
   * （否则旧轮次仍会启动关联查询并写回已卸载组件的状态）。
   * `reset()` 自增 token，因此卸载后到达的任何响应都会被丢弃。
   */
  onScopeDispose(() => {
    reset()
  })

  return { detail, related, loading, error, run, reset }
}
