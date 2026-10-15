import { describe, expect, it } from 'vitest';

import {
  resolveTaskTransition,
  resolveWorkOrderTransition,
  TASK_STATUS,
} from './work-order-state-machine.js';

describe('工单状态流转 —— 主线与 Q2-1 已批准流转（契约 §6.3 与 Q2 决策）', () => {
  it('主线：待启动 → 在产、在产 → 完工 允许', () => {
    expect(resolveWorkOrderTransition('待启动', '在产')).toEqual({ kind: 'allowed' });
    expect(resolveWorkOrderTransition('在产', '完工')).toEqual({ kind: 'allowed' });
  });

  it('Q2-1 已批准流转：暂停、恢复、关闭 5 组流转允许', () => {
    const approvedPairs = [
      ['在产', '暂停'],
      ['暂停', '在产'],
      ['待启动', '关闭'],
      ['在产', '关闭'],
      ['暂停', '关闭'],
    ] as const;
    for (const [from, to] of approvedPairs) {
      expect(resolveWorkOrderTransition(from, to)).toEqual({ kind: 'allowed' });
    }
  });

  it('跳过在产（待启动 → 完工 / 待启动 → 暂停）不合法', () => {
    expect(resolveWorkOrderTransition('待启动', '完工').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('待启动', '暂停').kind).toBe('invalid');
  });

  it('回退与跨态（在产 → 待启动 / 暂停 → 完工）不合法', () => {
    expect(resolveWorkOrderTransition('在产', '待启动').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('暂停', '完工').kind).toBe('invalid');
  });

  it('终态不可再流转（完工 → * / 关闭 → *）', () => {
    expect(resolveWorkOrderTransition('完工', '在产').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('完工', '关闭').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('完工', '暂停').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('关闭', '待启动').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('关闭', '在产').kind).toBe('invalid');
  });

  it('相同状态不算流转', () => {
    expect(resolveWorkOrderTransition('在产', '在产').kind).toBe('invalid');
    expect(resolveWorkOrderTransition('暂停', '暂停').kind).toBe('invalid');
  });
});

describe('任务状态流转 —— 仅开放主线', () => {
  it('待启动 → 在产 / 在产 → 完工 允许', () => {
    expect(resolveTaskTransition(TASK_STATUS.PENDING, TASK_STATUS.IN_PRODUCTION)).toEqual({
      kind: 'allowed',
    });
    expect(resolveTaskTransition(TASK_STATUS.IN_PRODUCTION, TASK_STATUS.COMPLETED)).toEqual({
      kind: 'allowed',
    });
  });

  it('跳步与回退不合法', () => {
    expect(resolveTaskTransition(TASK_STATUS.PENDING, TASK_STATUS.COMPLETED).kind).toBe('invalid');
    expect(resolveTaskTransition(TASK_STATUS.COMPLETED, TASK_STATUS.IN_PRODUCTION).kind).toBe(
      'invalid',
    );
  });

  it('不存在暂停 / 关闭（任务枚举只有三态）', () => {
    expect(resolveTaskTransition('在产', '暂停').kind).toBe('invalid');
  });

  it('不施加 Q2 未决的「工序顺序前置条件」：任意任务均可待启动 → 在产', () => {
    // 该函数只依据状态本身判定，不含"上一道工序是否完工"的条件
    expect(resolveTaskTransition(TASK_STATUS.PENDING, TASK_STATUS.IN_PRODUCTION)).toEqual({
      kind: 'allowed',
    });
  });
});
