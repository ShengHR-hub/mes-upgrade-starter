/**
 * 订单页面的纯逻辑（便于单测）。
 *
 * 这里承载两类判断：
 * 1. **可操作性判定**（审查意见「延期的未确认订单失去编辑、确认入口」→ §14.5；
 *    以及「工单索引不完整时可能误显示按钮」→ §16.2）；
 * 2. **日期范围筛选归一化**（审查意见「清空交期筛选后查询异常」→ §14.4）。
 */

import { ORDER_STATUS } from '@/types/order'

/**
 * 生命周期是否仍为「待确认」。
 *
 * 背景：接口返回的 `status` 是**派生展示状态**（已完成 > 已延期 > 生产中 > 生命周期原值），
 * 因此「待确认」这个生命周期原值在超期后会被展示成「已延期」；
 * 若前端仅按 `status === '待确认'` 显示按钮，这些订单就失去了编辑 / 确认入口。
 *
 * 契约 §6.1 的 Order 形状是冻结的（只有 `status` 一个状态字段），
 * 前端无法从单个字段反推生命周期原值，因此改用**是否存在关联工单**判定：
 * 一单一工单（契约 §6.2），订单一旦确认必然产生工单，
 * 所以「无关联工单 ⟺ 生命周期仍为待确认」。
 */
export function isOrderLifecyclePending(hasWorkOrder: boolean): boolean {
  return !hasWorkOrder
}

export interface OrderOperabilityInput {
  /** 接口返回的派生展示状态 */
  status: string
  /**
   * 是否存在关联工单：
   * - `true` / `false`：已知（工单索引完整）；
   * - `null`：**未知**（工单索引不完整或查询失败）。
   *
   * 未知时对「无法由状态本身确定」的行一律**不显示**入口 ——
   * 宁可少一个按钮（用户仍可通过后端提示得知原因），也不能给出会失败的入口。
   */
  hasWorkOrder: boolean | null
  /** 当前身份是否具备订单写权限（契约 §5.2） */
  canWrite: boolean
}

/**
 * 是否显示「编辑 / 确认」入口。
 *
 * 判定顺序（每一步都能**单独**得出结论，不依赖猜测）：
 * 1. 无写权限 → 否；
 * 2. `已确认` / `生产中` / `已完成` → 否（一单一工单，这些状态必然已有工单，不可能再编辑/确认）；
 * 3. `待确认` → 是（派生规则已保证无关联工单；若索引声称有工单，属数据不一致，保守隐藏）；
 * 4. 其余（`已延期`）→ 派生状态无法区分「未确认超期」与「已确认超期」，
 *    必须依赖工单关联；**未知则隐藏**。
 *
 * 注意：这**只是界面入口的显隐**，最终判定仍以后端为准
 * （后端按 `sale_order.status` 原值判定，不匹配返回 30003）。
 */
export function canOperateOrder(input: OrderOperabilityInput): boolean {
  if (!input.canWrite) return false

  if (
    input.status === ORDER_STATUS.CONFIRMED ||
    input.status === ORDER_STATUS.IN_PRODUCTION ||
    input.status === ORDER_STATUS.COMPLETED
  ) {
    return false
  }

  if (input.status === ORDER_STATUS.PENDING) {
    return input.hasWorkOrder !== true
  }

  // 已延期（或未知状态）：必须确知「无关联工单」才显示
  if (input.hasWorkOrder === null) return false
  return !input.hasWorkOrder
}

/**
 * 归一化日期区间筛选值。
 *
 * `el-date-picker` 的 `daterange` 在**清空后会把 v-model 置为 `null`**（不是 `[]`），
 * 初版直接 `const [from, to] = filters.dueDateRange` 解构，清空后即抛
 * `TypeError: ... is not iterable`，导致"清空筛选后查询"整页报错。
 *
 * 本函数对任意输入都返回安全的二元组；空串同样视为"未填"。
 */
export function normalizeDateRange(value: unknown): [string | undefined, string | undefined] {
  if (!Array.isArray(value)) return [undefined, undefined]
  const [from, to] = value as [unknown, unknown]
  return [toNonEmptyString(from), toNonEmptyString(to)]
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
