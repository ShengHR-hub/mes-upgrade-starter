import { describe, expect, it } from 'vitest';

import {
  enqueuePendingReport,
  createPendingReport,
  loadPendingReports,
  markPendingReportRejected,
  removePendingReport,
  updatePendingReportQuantities,
  createMemoryStore,
  pendingStorageKeyFor,
  type KeyValueStore,
} from './offline-queue';
import { hasRejectionNotice, pendingItemActions } from './pending-item-actions';

/**
 * 待提交记录操作集 + 「拒绝不死循环」端到端单测（S11 复审 P2 #5）。
 *
 * 场景回归（复审判定的死循环）：
 * 离线入队 → 确认提交被明确拒绝 → **必须**存在「编辑数量后重试」与「移除」出口，
 * 而不是只剩一个会再次发送同一无效请求的「确认提交」。
 */

function storeWithPending(): { store: KeyValueStore; key: string; id: string } {
  const store = createMemoryStore();
  const key = pendingStorageKeyFor('1');
  const items = enqueuePendingReport(
    store,
    key,
    createPendingReport({ taskId: '301', goodQty: 10, badQty: 1, ownerId: '1' }),
  );
  return { store, key, id: items[0].id };
}

describe('pendingItemActions', () => {
  it('pending（本人）：提交 / 编辑 / 移除全部开放', () => {
    const item = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' });
    expect(pendingItemActions(item, '1')).toEqual({
      canSubmit: true,
      canEdit: true,
      canRemove: true,
      canDiscard: false,
    });
  });

  it('被明确拒绝的 pending：操作集不变（拒绝原因只影响展示，不锁死出口）', () => {
    const item = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1', status: 'pending' });
    const rejected = { ...item, lastRejection: { code: 30003, message: '工单当前状态不允许报工' } };
    expect(pendingItemActions(rejected, '1')).toEqual({
      canSubmit: true,
      canEdit: true,
      canRemove: true,
      canDiscard: false,
    });
    expect(hasRejectionNotice(rejected)).toBe(true);
    expect(hasRejectionNotice(item)).toBe(false);
  });

  it('unknown（结果不明）：仅可人工核查后移除，不可提交 / 编辑', () => {
    const item = createPendingReport({
      taskId: '1',
      goodQty: 1,
      badQty: 0,
      ownerId: '1',
      status: 'unknown',
    });
    expect(pendingItemActions(item, '1')).toEqual({
      canSubmit: false,
      canEdit: false,
      canRemove: false,
      canDiscard: true,
    });
    expect(hasRejectionNotice(item)).toBe(false);
  });

  it('非本人 / 无登录用户：任何操作都不可用', () => {
    const item = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' });
    expect(pendingItemActions(item, '2')).toEqual(NO_ACTIONS_SHAPE);
    expect(pendingItemActions(item, null)).toEqual(NO_ACTIONS_SHAPE);
  });
});

const NO_ACTIONS_SHAPE = { canSubmit: false, canEdit: false, canRemove: false, canDiscard: false };

describe('拒绝后的修正与移除（不死循环回归）', () => {
  it('明确拒绝：记录 lastRejection 且状态保持 pending', () => {
    const { store, key, id } = storeWithPending();
    const next = markPendingReportRejected(store, key, id, {
      code: 30003,
      message: '工单当前状态为「待启动」，仅在产工单允许报工',
    });
    expect(next[0].status).toBe('pending');
    expect(next[0].lastRejection?.code).toBe(30003);
    // 刷新（重新加载）后拒绝原因仍在
    expect(loadPendingReports(store, key)[0].lastRejection?.message).toContain('仅在产工单允许报工');
  });

  it('出口一「修改数量后重试」：数量更新且拒绝原因被清除', () => {
    const { store, key, id } = storeWithPending();
    markPendingReportRejected(store, key, id, { code: 10003, message: '数量不合法' });
    const next = updatePendingReportQuantities(store, key, id, { goodQty: 5, badQty: 0 });
    expect(next[0].goodQty).toBe(5);
    expect(next[0].badQty).toBe(0);
    expect(next[0].lastRejection).toBeNull();
    // 修正后回到「无拒绝原因」的普通 pending，可正常确认提交
    expect(hasRejectionNotice(next[0])).toBe(false);
    expect(pendingItemActions(next[0], '1').canSubmit).toBe(true);
  });

  it('出口二「移除」：拒绝记录可被用户直接清理', () => {
    const { store, key, id } = storeWithPending();
    markPendingReportRejected(store, key, id, { code: 30006, message: '当前能力不可用' });
    expect(removePendingReport(store, key, id)).toEqual([]);
  });

  it('非法数量（0/0、负数、小数）不修改存储', () => {
    const { store, key, id } = storeWithPending();
    for (const bad of [
      { goodQty: 0, badQty: 0 },
      { goodQty: -1, badQty: 1 },
      { goodQty: 1.5, badQty: 0 },
    ]) {
      const next = updatePendingReportQuantities(store, key, id, bad);
      expect(next[0].goodQty).toBe(10);
      expect(next[0].badQty).toBe(1);
    }
  });

  it('形状非法的 lastRejection 归一化为 null（不丢整条记录）', () => {
    const store = createMemoryStore();
    const key = pendingStorageKeyFor('1');
    store.setItem(
      key,
      JSON.stringify([
        {
          id: 'x',
          taskId: '1',
          goodQty: 1,
          badQty: 0,
          workOrderCode: null,
          ownerId: '1',
          createdAt: 't',
          status: 'pending',
          lastRejection: 'garbage',
        },
      ]),
    );
    const items = loadPendingReports(store, key);
    expect(items.length).toBe(1);
    expect(items[0].lastRejection).toBeNull();
  });
});
