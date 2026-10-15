import { describe, expect, it } from 'vitest'

import { canOperateOrder, isOrderLifecyclePending, normalizeDateRange } from './order-view'

describe('canOperateOrder —— 派生状态 ≠ 生命周期状态（S5 审查意见回归）', () => {
  const base = { hasWorkOrder: false, canWrite: true }

  it('无工单 + 展示「待确认」→ 可操作', () => {
    expect(canOperateOrder({ ...base, status: '待确认' })).toBe(true)
  })

  it('无工单 + 展示「已延期」→ **仍可操作**（§14.5 修复的核心）', () => {
    // 超期的待确认订单会被后端展示为「已延期」，但它生命周期仍是待确认
    expect(canOperateOrder({ ...base, status: '已延期' })).toBe(true)
  })

  it('有工单 + 展示「已延期」→ 不可操作（已确认且超期）', () => {
    expect(canOperateOrder({ status: '已延期', hasWorkOrder: true, canWrite: true })).toBe(false)
  })

  it('有工单 + 展示「已确认」→ 不可操作', () => {
    expect(canOperateOrder({ status: '已确认', hasWorkOrder: true, canWrite: true })).toBe(false)
  })

  it('展示「已完成」/「生产中」→ 不可操作（双保险）', () => {
    expect(canOperateOrder({ ...base, status: '已完成' })).toBe(false)
    expect(canOperateOrder({ ...base, status: '生产中' })).toBe(false)
  })

  it('无写权限（operator）→ 一律不可操作', () => {
    for (const status of ['待确认', '已确认', '已延期', '生产中', '已完成']) {
      expect(canOperateOrder({ status, hasWorkOrder: false, canWrite: false }), status).toBe(false)
    }
  })

  it('isOrderLifecyclePending 只由「有无工单」决定', () => {
    expect(isOrderLifecyclePending(false)).toBe(true)
    expect(isOrderLifecyclePending(true)).toBe(false)
  })
})

describe('canOperateOrder —— 工单关联「未知」时必须保守隐藏（§16.2 回归）', () => {
  /**
   * 审查 P2：「工单索引只取前 100 张、失败后置空集合 → 已有工单的订单可能重新显示编辑/确认按钮」。
   * 修复后索引带 `complete` 标记，未知时传入 `hasWorkOrder = null`。
   */
  it('**「已延期」+ 未知 → 不显示**（无法区分未确认超期与已确认超期）', () => {
    expect(canOperateOrder({ status: '已延期', hasWorkOrder: null, canWrite: true })).toBe(false)
  })

  it('「待确认」+ 未知 → 显示（该状态的派生条件本身已保证无关联工单）', () => {
    expect(canOperateOrder({ status: '待确认', hasWorkOrder: null, canWrite: true })).toBe(true)
  })

  it('「已确认」/「生产中」/「已完成」+ 未知 → 不显示（必然已有工单）', () => {
    for (const status of ['已确认', '生产中', '已完成']) {
      expect(canOperateOrder({ status, hasWorkOrder: null, canWrite: true }), status).toBe(false)
    }
  })

  it('索引完整且确知有工单 → 一律不显示', () => {
    for (const status of ['待确认', '已延期']) {
      expect(canOperateOrder({ status, hasWorkOrder: true, canWrite: true }), status).toBe(false)
    }
  })
})

describe('normalizeDateRange —— 清空筛选后不得抛异常（S5 审查意见回归）', () => {
  it('清空（null）→ 返回空二元组，不抛 TypeError', () => {
    expect(() => normalizeDateRange(null)).not.toThrow()
    expect(normalizeDateRange(null)).toEqual([undefined, undefined])
  })

  it('undefined / 非数组 → 空二元组', () => {
    expect(normalizeDateRange(undefined)).toEqual([undefined, undefined])
    expect(normalizeDateRange('2026-10-01')).toEqual([undefined, undefined])
    expect(normalizeDateRange({})).toEqual([undefined, undefined])
  })

  it('正常区间原样返回', () => {
    expect(normalizeDateRange(['2026-10-01', '2026-10-31'])).toEqual(['2026-10-01', '2026-10-31'])
  })

  it('空串视为未填', () => {
    expect(normalizeDateRange(['', ''])).toEqual([undefined, undefined])
  })

  it('只有一端有效时另一端为 undefined', () => {
    expect(normalizeDateRange(['2026-10-01', null])).toEqual(['2026-10-01', undefined])
  })

  it('空数组 → 空二元组', () => {
    expect(normalizeDateRange([])).toEqual([undefined, undefined])
  })
})
