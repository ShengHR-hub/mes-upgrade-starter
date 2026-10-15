/**
 * 工单索引（订单页专用）：记录「已有工单的订单 ID」及索引是否**完整**。
 *
 * 为什么要它：接口返回的 `status` 是**派生展示状态**，超期的待确认订单会被展示为
 * 「已延期」，前端仅凭 `status` 无法判断能否编辑/确认；契约 §6.1 的 Order 形状冻结、
 * 不能加字段，因此改用「是否存在关联工单」这一等价判据（一单一工单）。
 *
 * ⚠️ 修复记录：
 * - 审查第三轮 P2「索引只取前 100 张 / 失败后置空集合」→ ① 分页拉全，`fetched >= total`
 *   判定完整性；② 失败或不完整时 `hasWorkOrderOf()` 返回 `null`（未知），界面保守隐藏。
 * - 审查第四轮 P2「刷新期间沿用旧工单索引」→
 *   ① `invalidate()` **立即**把索引置为「未知」——等待新索引期间，
 *   依赖索引判定的按钮必须隐藏，不得沿用上一轮筛选状态下的旧判定；
 *   ② **代数（generation）隔离**并发轮次：每轮写入前校验自己仍是最新的，
 *   迟到的旧轮次（慢请求后完成）不得覆盖新一轮的结果。
 */

import { ref } from 'vue'

export interface WorkOrderIndexPage {
  list: Array<{ saleOrderId?: string | null }>
  total: number
}

export interface WorkOrderIndexOptions {
  /** 拉取一页工单（注入以便测试；实现里传 workOrdersService.list） */
  fetchPage: (page: number, pageSize: number) => Promise<WorkOrderIndexPage>
  pageSize?: number
  maxPages?: number
}

export interface WorkOrderIndexState {
  ids: ReadonlySet<string>
  complete: boolean
}

/** 该订单是否有关联工单；`null` = 未知（索引不完整、查询失败或刷新中） */
export type WorkOrderKnown = boolean | null

export function useWorkOrderIndex(options: WorkOrderIndexOptions) {
  const pageSize = options.pageSize ?? 100
  const maxPages = options.maxPages ?? 20

  const state = ref<WorkOrderIndexState>({ ids: new Set(), complete: false })

  /** 代数：任何使索引内容失效/重置的操作都会自增，使在途轮次的写入作废 */
  let generation = 0

  /** 立即失效旧索引：所有「未知」判定即刻生效，依赖判定的按钮保守隐藏 */
  function invalidate(): void {
    generation += 1
    state.value = { ids: new Set(), complete: false }
  }

  /** 本页没有任何「已延期」行时的快速路径：索引确定为空且完整 */
  function markEmptyComplete(): void {
    generation += 1
    state.value = { ids: new Set(), complete: true }
  }

  /** 分页拉全工单并重建索引；已被新一轮取代的轮次不写入任何状态 */
  async function load(): Promise<void> {
    const token = generation + 1
    generation = token

    const ids = new Set<string>()
    let fetched = 0
    let total = 0

    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await options.fetchPage(page, pageSize)
        if (token !== generation) return // 已被新一轮取代
        total = result.total
        fetched += result.list.length
        for (const workOrder of result.list) {
          if (workOrder.saleOrderId) ids.add(workOrder.saleOrderId)
        }
        if (fetched >= total || result.list.length === 0) break
      }
    } catch {
      // 查询失败 → 索引不完整，对不确定的行隐藏可执行按钮（宁缺勿错）
      if (token !== generation) return
      state.value = { ids: new Set(), complete: false }
      return
    }

    if (token !== generation) return
    state.value = { ids, complete: fetched >= total }
  }

  /** 该订单是否有关联工单；`null` = 未知 */
  function hasWorkOrderOf(orderId: string): WorkOrderKnown {
    if (state.value.ids.has(orderId)) return true
    return state.value.complete ? false : null
  }

  return { state, invalidate, load, markEmptyComplete, hasWorkOrderOf }
}
