import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_OWNER,
  clearPendingReports,
  createPendingReport,
  enqueuePendingReport,
  filterOwnedReports,
  isOwnedBy,
  loadPendingReports,
  markPendingReportUnknown,
  partitionPendingReports,
  pendingStorageKeyFor,
  removePendingReport,
  createMemoryStore,
  type KeyValueStore,
} from './offline-queue';

/**
 * B13 离线待提交队列单测（任务书 §B13 要求 6~8 + S11 复审 P2 修复）。
 *
 * 覆盖：
 * - 按用户隔离存储键与 ownerId 归属核对（跨账号不得提交他人输入）；
 * - 「未提交（pending）」与「结果未知（unknown）」两种状态语义；
 * - 离线入队、确认提交出队、人工核查后移除；
 * - 损坏数据按空队列处理；队列不存令牌。
 */

function freshStore(): KeyValueStore {
  return createMemoryStore();
}

const KEY_A = pendingStorageKeyFor('1');
const KEY_B = pendingStorageKeyFor('2');
const KEY_ANON = pendingStorageKeyFor(null);

describe('pendingStorageKeyFor —— 按用户隔离', () => {
  it('不同用户得到不同存储键', () => {
    expect(KEY_A).not.toBe(KEY_B);
    expect(KEY_A).toBe('mes.mobile.pendingReports.v2.1');
  });

  it('无用户时使用 anonymous 占位键', () => {
    expect(KEY_ANON).toBe(`mes.mobile.pendingReports.v2.${ANONYMOUS_OWNER}`);
    expect(pendingStorageKeyFor(undefined)).toBe(KEY_ANON);
    expect(pendingStorageKeyFor('')).toBe(KEY_ANON);
  });
});

describe('入队 / 出队', () => {
  it('入队后标记为 pending（未提交）并携带 ownerId', () => {
    const store = freshStore();
    const items = enqueuePendingReport(
      store,
      KEY_A,
      createPendingReport({ taskId: '301', goodQty: 10, badQty: 1, ownerId: '1', workOrderCode: 'WO-1' }),
    );
    expect(items.length).toBe(1);
    expect(items[0].status).toBe('pending');
    expect(items[0].ownerId).toBe('1');
  });

  it('多次入队保持用户操作顺序（追加到末尾）', () => {
    const store = freshStore();
    enqueuePendingReport(store, KEY_A, createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' }));
    const items = enqueuePendingReport(
      store,
      KEY_A,
      createPendingReport({ taskId: '2', goodQty: 2, badQty: 0, ownerId: '1' }),
    );
    expect(items.map((item) => item.taskId)).toEqual(['1', '2']);
  });

  it('确认提交后按 id 出队（用户确认后才移除）', () => {
    const store = freshStore();
    enqueuePendingReport(store, KEY_A, createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' }));
    const items = loadPendingReports(store, KEY_A);
    const next = removePendingReport(store, KEY_A, items[0].id);
    expect(next.length).toBe(0);
    expect(loadPendingReports(store, KEY_A).length).toBe(0);
  });

  it('移除不存在的 id 不影响队列', () => {
    const store = freshStore();
    enqueuePendingReport(store, KEY_A, createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' }));
    expect(removePendingReport(store, KEY_A, 'no-such-id').length).toBe(1);
  });

  it('clearPendingReports 清空指定用户的队列（主动退出）', () => {
    const store = freshStore();
    enqueuePendingReport(store, KEY_A, createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' }));
    clearPendingReports(store, KEY_A);
    expect(loadPendingReports(store, KEY_A)).toEqual([]);
  });
});

describe('跨账号隔离（复审 P2 #1）', () => {
  it('账号 A 的待提交记录不出现在账号 B 的存储键下', () => {
    const store = freshStore();
    enqueuePendingReport(store, KEY_A, createPendingReport({ taskId: '1', goodQty: 5, badQty: 0, ownerId: '1' }));
    expect(loadPendingReports(store, KEY_B)).toEqual([]);
    expect(loadPendingReports(store, KEY_A).length).toBe(1);
  });

  it('isOwnedBy：仅本人记录返回 true；无当前用户一律 false', () => {
    const mine = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' });
    expect(isOwnedBy(mine, '1')).toBe(true);
    expect(isOwnedBy(mine, '2')).toBe(false);
    expect(isOwnedBy(mine, null)).toBe(false);
  });

  it('filterOwnedReports：过滤跨账号残留与无归属记录', () => {
    const mine = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' });
    const other = createPendingReport({ taskId: '2', goodQty: 1, badQty: 0, ownerId: '2' });
    const orphan = createPendingReport({ taskId: '3', goodQty: 1, badQty: 0, ownerId: null });
    expect(filterOwnedReports([mine, other, orphan], '1').map((item) => item.taskId)).toEqual(['1']);
    expect(filterOwnedReports([mine, other], null)).toEqual([]);
  });

  it('历史共享键数据（无 ownerId 字段）被 filterOwnedReports 拒绝', () => {
    const legacy = { id: 'x', taskId: '1', goodQty: 1, badQty: 0, workOrderCode: null, createdAt: 't', status: 'pending' };
    expect(filterOwnedReports([legacy as never], '1')).toEqual([]);
  });
});

describe('「结果未知」状态（复审 P2 #2）', () => {
  it('createPendingReport 支持 unknown 状态', () => {
    const item = createPendingReport({
      taskId: '1',
      goodQty: 1,
      badQty: 0,
      ownerId: '1',
      status: 'unknown',
    });
    expect(item.status).toBe('unknown');
  });

  it('markPendingReportUnknown 把 pending 转为 unknown（不再可普通补交）', () => {
    const store = freshStore();
    enqueuePendingReport(store, KEY_A, createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' }));
    const [first] = loadPendingReports(store, KEY_A);
    const next = markPendingReportUnknown(store, KEY_A, first.id);
    expect(next[0].status).toBe('unknown');
  });

  it('partitionPendingReports：unknown 不进可补交组', () => {
    const pendingItem = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' });
    const unknownItem = createPendingReport({
      taskId: '2',
      goodQty: 1,
      badQty: 0,
      ownerId: '1',
      status: 'unknown',
    });
    const { sendable, unknown } = partitionPendingReports([pendingItem, unknownItem]);
    expect(sendable.map((item) => item.taskId)).toEqual(['1']);
    expect(unknown.map((item) => item.taskId)).toEqual(['2']);
  });
});

describe('鲁棒性', () => {
  it('损坏 / 非数组存储内容按空队列处理（不抛错、不阻塞报工）', () => {
    const store = freshStore();
    store.setItem(KEY_A, '{not-json');
    expect(loadPendingReports(store, KEY_A)).toEqual([]);
    store.setItem(KEY_A, '{"a":1}');
    expect(loadPendingReports(store, KEY_A)).toEqual([]);
    // 混入非法条目时过滤，合法条目保留
    store.setItem(
      KEY_A,
      JSON.stringify([
        { id: 'x', taskId: '1', goodQty: 1, badQty: 0, workOrderCode: null, ownerId: '1', createdAt: 't', status: 'pending' },
        { id: 'y', taskId: '2', goodQty: 'no', badQty: 0, workOrderCode: null, ownerId: '1', createdAt: 't', status: 'pending' },
        { id: 'z', taskId: '3', goodQty: 1, badQty: 0, workOrderCode: null, ownerId: '1', createdAt: 't', status: 'weird' },
      ]),
    );
    const items = loadPendingReports(store, KEY_A);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('x');
  });

  it('队列内容不含令牌或密钥字段（只存业务输入与归属）', () => {
    const store = freshStore();
    const item = createPendingReport({ taskId: '1', goodQty: 1, badQty: 0, ownerId: '1' });
    enqueuePendingReport(store, KEY_A, item);
    const raw = store.getItem(KEY_A) ?? '';
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('Authorization');
    expect(Object.keys(item).sort()).toEqual(
      ['badQty', 'createdAt', 'goodQty', 'id', 'ownerId', 'status', 'taskId', 'workOrderCode'].sort(),
    );
  });
});
