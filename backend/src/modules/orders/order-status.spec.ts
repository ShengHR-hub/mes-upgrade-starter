import { describe, expect, it } from 'vitest';

import {
  buildDerivedOrderStatusSql,
  deriveOrderStatus,
  ORDER_STATUS,
  type OrderStatusInput,
} from './order-status.js';

function input(overrides: Partial<OrderStatusInput> = {}): OrderStatusInput {
  return {
    baseStatus: ORDER_STATUS.PENDING,
    workOrderTotal: 0,
    workOrderOpen: 0,
    workOrderActive: 0,
    dueDate: '2026-10-15',
    businessDate: '2026-10-10',
    ...overrides,
  };
}

describe('deriveOrderStatus —— 契约 §6.2 判定优先级 已完成 > 已延期 > 生产中', () => {
  it('无关联工单且未超期：保持数据库原值「待确认」', () => {
    expect(deriveOrderStatus(input())).toBe(ORDER_STATUS.PENDING);
  });

  it('无关联工单且未超期：保持数据库原值「已确认」', () => {
    expect(deriveOrderStatus(input({ baseStatus: ORDER_STATUS.CONFIRMED }))).toBe(
      ORDER_STATUS.CONFIRMED,
    );
  });

  it('空集合不算完成：无关联工单 + 已超期 → 已延期（不是已完成）', () => {
    expect(deriveOrderStatus(input({ businessDate: '2026-10-16' }))).toBe(ORDER_STATUS.DELAYED);
  });

  it('当天等于 dueDate 不算延期', () => {
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          businessDate: '2026-10-15',
          dueDate: '2026-10-15',
        }),
      ),
    ).toBe(ORDER_STATUS.CONFIRMED);
  });

  it('次日超过 dueDate 即延期', () => {
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          businessDate: '2026-10-16',
          dueDate: '2026-10-15',
        }),
      ),
    ).toBe(ORDER_STATUS.DELAYED);
  });

  it('关联工单全部完工 → 已完成（即使已超期）', () => {
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          workOrderTotal: 1,
          workOrderOpen: 0,
          workOrderActive: 0,
          businessDate: '2026-11-01',
        }),
      ),
    ).toBe(ORDER_STATUS.COMPLETED);
  });

  it('「关闭」不是完工：含关闭工单 + 已超期 → 已延期', () => {
    // workOrderOpen 统计的是 status <> '完工'，关闭工单计入未完工
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          workOrderTotal: 1,
          workOrderOpen: 1,
          workOrderActive: 0,
          businessDate: '2026-11-01',
        }),
      ),
    ).toBe(ORDER_STATUS.DELAYED);
  });

  it('存在在产工单且未超期 → 生产中', () => {
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          workOrderTotal: 1,
          workOrderOpen: 1,
          workOrderActive: 1,
        }),
      ),
    ).toBe(ORDER_STATUS.IN_PRODUCTION);
  });

  it('存在在产工单但已超期 → 已延期（延期优先于生产中）', () => {
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          workOrderTotal: 1,
          workOrderOpen: 1,
          workOrderActive: 1,
          businessDate: '2026-10-20',
        }),
      ),
    ).toBe(ORDER_STATUS.DELAYED);
  });

  it('未完工且无在产工单（如仅待启动）→ 回到原值', () => {
    expect(
      deriveOrderStatus(
        input({
          baseStatus: ORDER_STATUS.CONFIRMED,
          workOrderTotal: 1,
          workOrderOpen: 1,
          workOrderActive: 0,
        }),
      ),
    ).toBe(ORDER_STATUS.CONFIRMED);
  });

  it('数据库残留非生命周期状态（如 生产中）但无在产工单 → 归一到 已确认', () => {
    expect(deriveOrderStatus(input({ baseStatus: ORDER_STATUS.IN_PRODUCTION }))).toBe(
      ORDER_STATUS.CONFIRMED,
    );
  });
});

describe('buildDerivedOrderStatusSql —— 与纯函数同口径', () => {
  const sql = buildDerivedOrderStatusSql('2026-10-10');

  it('包含完成判定（有工单且无未完工工单）', () => {
    expect(sql).toContain('SELECT COUNT(*) FROM work_order w WHERE w.sale_order_id = o.id');
    expect(sql).toContain("w.status <> '完工'");
    expect(sql).toContain("THEN '已完成'");
  });

  it('延期判定使用 due_date < 当日（当天相等不触发）', () => {
    expect(sql).toContain("o.due_date < '2026-10-10'");
    expect(sql).toContain("THEN '已延期'");
  });

  it('生产中判定基于在产工单', () => {
    expect(sql).toContain("w.status = '在产'");
    expect(sql).toContain("THEN '生产中'");
  });

  it('兜底只回落到 待确认 / 已确认', () => {
    expect(sql).toContain("ELSE IF(o.status = '待确认', '待确认', '已确认')");
  });

  it('优先级顺序：已完成 → 已延期 → 生产中', () => {
    const completed = sql.indexOf("THEN '已完成'");
    const delayed = sql.indexOf("THEN '已延期'");
    const producing = sql.indexOf("THEN '生产中'");
    expect(completed).toBeGreaterThan(-1);
    expect(completed).toBeLessThan(delayed);
    expect(delayed).toBeLessThan(producing);
  });
});
