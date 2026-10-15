import { describe, expect, it } from 'vitest';

import {
  allocateDailyPlanSeries,
  calculatePlanQtyInWindow,
} from './plan-allocation.util.js';

describe('plan-allocation.util (每日计划分摊契约 §6.8 / Q5)', () => {
  it('100件分7天：前6天各14件，最后1天补差16件，总数精确等于100', () => {
    const series = allocateDailyPlanSeries(100, '2026-10-09', '2026-10-15');
    expect(series).toHaveLength(7);
    expect(series.map((s) => s.planQty)).toEqual([14, 14, 14, 14, 14, 14, 16]);
    expect(series.reduce((sum, s) => sum + s.planQty, 0)).toBe(100);
  });

  it('单日计划为全部 qty', () => {
    const series = allocateDailyPlanSeries(88, '2026-10-09', '2026-10-09');
    expect(series).toHaveLength(1);
    expect(series[0].planQty).toBe(88);
  });

  it('qty 小于天数：前几天为 0，差额在最后一天补齐', () => {
    const series = allocateDailyPlanSeries(3, '2026-10-09', '2026-10-13');
    expect(series).toHaveLength(5);
    expect(series.map((s) => s.planQty)).toEqual([0, 0, 0, 0, 3]);
    expect(series.reduce((sum, s) => sum + s.planQty, 0)).toBe(3);
  });

  it('跨月分配正常计算天数与日期序列', () => {
    const series = allocateDailyPlanSeries(100, '2026-10-30', '2026-11-02');
    expect(series).toHaveLength(4);
    expect(series.map((s) => s.date)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(series.map((s) => s.planQty)).toEqual([25, 25, 25, 25]);
    expect(series.reduce((sum, s) => sum + s.planQty, 0)).toBe(100);
  });

  describe('calculatePlanQtyInWindow 窗口计划计算', () => {
    const planStart = '2026-10-09';
    const planEnd = '2026-10-15';
    const qty = 100;

    it('单日窗口首日：14', () => {
      const plan = calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-09', '2026-10-09');
      expect(plan).toBe(14);
    });

    it('单日窗口末日：16', () => {
      const plan = calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-15', '2026-10-15');
      expect(plan).toBe(16);
    });

    it('中间3天窗口：14 * 3 = 42', () => {
      const plan = calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-10', '2026-10-12');
      expect(plan).toBe(42);
    });

    it('覆盖完整计划周期窗口：100', () => {
      const plan = calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-09', '2026-10-15');
      expect(plan).toBe(100);
    });

    it('大于计划周期的宽窗口：100', () => {
      const plan = calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-01', '2026-10-31');
      expect(plan).toBe(100);
    });

    it('完全不相交窗口：0', () => {
      expect(calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-01', '2026-10-08')).toBe(0);
      expect(calculatePlanQtyInWindow(qty, planStart, planEnd, '2026-10-16', '2026-10-20')).toBe(0);
    });
  });

  describe('异常输入保护', () => {
    it('非法日期抛错', () => {
      expect(() => allocateDailyPlanSeries(100, '2026-02-31', '2026-03-05')).toThrow();
    });

    it('开始晚于结束抛错', () => {
      expect(() => allocateDailyPlanSeries(100, '2026-10-15', '2026-10-09')).toThrow();
    });
  });
});
