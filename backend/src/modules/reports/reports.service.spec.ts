import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { ReportsService } from './reports.service.js';

interface Harness {
  service: ReportsService;
  queryLog: Array<{ sql: string; params: unknown[] }>;
}

function makeHarness(customQuery?: (sql: string, params: unknown[]) => Promise<unknown>): Harness {
  const queryLog: Array<{ sql: string; params: unknown[] }> = [];

  const defaultQuery = async (sql: string, params: unknown[] = []) => {
    queryLog.push({ sql, params });

    // Read task meta for lock ordering
    if (sql.includes('SELECT work_order_id FROM work_task WHERE id = ?')) {
      return [{ work_order_id: '201' }];
    }
    // Lock work order
    if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
      return [{ id: '201', status: '在产', done_qty: 10 }];
    }
    // Lock task
    if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
      return [{ id: '301', work_order_id: '201', seq: 10, status: '在产', good_qty: 10, bad_qty: 0 }];
    }
    // Max seq query
    if (sql.includes('FROM work_task WHERE work_order_id = ? ORDER BY seq DESC LIMIT 1')) {
      return [{ id: '301', seq: 10 }];
    }
    // Insert report
    if (sql.includes('INSERT INTO report')) {
      return { insertId: 401 };
    }
    // Read updated task
    if (sql.includes('SELECT good_qty, bad_qty FROM work_task WHERE id = ?')) {
      return [{ good_qty: 86, bad_qty: 4 }];
    }
    // Read updated work order
    if (sql.includes('SELECT done_qty FROM work_order WHERE id = ?')) {
      return [{ done_qty: 86 }];
    }
    // Read created report with epoch
    if (sql.includes('FROM report r WHERE id = ?')) {
      return [{ id: 401, task_id: 301, user_id: 2, good_qty: 76, bad_qty: 4, reported_at_epoch: 1770000000 }];
    }
    // Count query
    if (sql.includes('SELECT COUNT(*) AS total FROM report')) {
      return [{ total: 1 }];
    }
    // Rows query
    if (sql.includes('SELECT r.id, r.task_id')) {
      return [{ id: 401, task_id: 301, user_id: 2, good_qty: 76, bad_qty: 4, reported_at_epoch: 1770000000 }];
    }

    return [];
  };

  const queryFn = customQuery || defaultQuery;

  const manager = {
    query: vi.fn(queryFn),
  };

  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) => work(manager),
    query: vi.fn(queryFn),
  };

  const audit = {
    write: vi.fn(async () => undefined),
  };

  const service = new ReportsService(dataSource as never, audit as never);
  return { service, queryLog };
}

describe('ReportsService —— B3 生产报工', () => {
  describe('创建报工（服务级流程闭环与异常传播）', () => {
    it('统一锁顺序：报工先锁工单 FOR UPDATE，后锁任务 FOR UPDATE（与质检全局锁顺序一致，防死锁）', async () => {
      const { service, queryLog } = makeHarness();

      await service.create(
        { taskId: '301', goodQty: 10, badQty: 0 },
        { userId: '2', ip: null },
      );

      const woLockIdx = queryLog.findIndex((q) => q.sql.includes('FROM work_order WHERE id = ? FOR UPDATE'));
      const taskLockIdx = queryLog.findIndex((q) => q.sql.includes('FROM work_task WHERE id = ? FOR UPDATE'));

      expect(woLockIdx).toBeGreaterThanOrEqual(0);
      expect(taskLockIdx).toBeGreaterThanOrEqual(0);
      expect(woLockIdx).toBeLessThan(taskLockIdx);
    });

    it('末道工序报工：累计工序 goodQty/badQty 并累计工单 doneQty', async () => {
      const { service, queryLog } = makeHarness();

      const result = await service.create(
        { taskId: '301', goodQty: 76, badQty: 4 },
        { userId: '2', ip: '127.0.0.1' },
      );

      expect(result.report.id).toBe('401');
      expect(result.report.goodQty).toBe(76);
      expect(result.report.badQty).toBe(4);
      expect(result.report.reportedAt).toContain('2026-');
      expect(result.taskTotals.goodQty).toBe(86);
      expect(result.workOrderTotals.doneQty).toBe(86);

      // 验证工单 done_qty 增量更新执行
      const woUpdate = queryLog.find((q) => q.sql.includes('UPDATE work_order SET done_qty = done_qty + ?'));
      expect(woUpdate).toBeDefined();
      expect(woUpdate?.params).toEqual([76, '201']);
    });

    it('非末道工序报工：更新任务数量，但不累加工单 doneQty', async () => {
      const { service, queryLog } = makeHarness(async (sql) => {
        if (sql.includes('SELECT work_order_id FROM work_task WHERE id = ?')) {
          return [{ work_order_id: '201' }];
        }
        if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
          return [{ id: '201', status: '在产', done_qty: 0 }];
        }
        if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
          return [{ id: '301', work_order_id: '201', seq: 5, status: '在产', good_qty: 0, bad_qty: 0 }];
        }
        // 末道工序为 seq 10（非当前工序）
        if (sql.includes('FROM work_task WHERE work_order_id = ? ORDER BY seq DESC LIMIT 1')) {
          return [{ id: '305', seq: 10 }];
        }
        if (sql.includes('INSERT INTO report')) return { insertId: 402 };
        if (sql.includes('SELECT good_qty, bad_qty FROM work_task')) return [{ good_qty: 50, bad_qty: 0 }];
        if (sql.includes('SELECT done_qty FROM work_order')) return [{ done_qty: 0 }];
        if (sql.includes('FROM report r WHERE id = ?')) {
          return [{ id: 402, task_id: 301, user_id: 2, good_qty: 50, bad_qty: 0, reported_at_epoch: 1770000000 }];
        }
        return [];
      });

      const result = await service.create(
        { taskId: '301', goodQty: 50, badQty: 0 },
        { userId: '2', ip: null },
      );

      expect(result.report.id).toBe('402');
      const woUpdate = queryLog.find((q) => q.sql.includes('UPDATE work_order SET done_qty'));
      expect(woUpdate).toBeUndefined();
    });

    it('服务级故障传播：审计写入异常时事务中断并向外传播错误', async () => {
      const auditError = new Error('Audit insert failed');
      const manager = {
        query: async (sql: string) => {
          if (sql.includes('SELECT work_order_id FROM work_task WHERE id = ?')) {
            return [{ work_order_id: '201' }];
          }
          if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
            return [{ id: '201', status: '在产', done_qty: 0 }];
          }
          if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
            return [{ id: '301', work_order_id: '201', seq: 10, status: '在产', good_qty: 0, bad_qty: 0 }];
          }
          if (sql.includes('INSERT INTO report')) return { insertId: 403 };
          if (sql.includes('FROM work_task WHERE work_order_id = ? ORDER BY seq DESC LIMIT 1')) {
            return [{ id: '301', seq: 10 }];
          }
          return [];
        },
      };

      const dataSource = {
        transaction: async (work: (m: unknown) => Promise<unknown>) => work(manager),
        query: async () => [],
      };
      const audit = {
        write: vi.fn(async () => {
          throw auditError;
        }),
      };

      const service = new ReportsService(dataSource as never, audit as never);
      await expect(
        service.create({ taskId: '301', goodQty: 10, badQty: 0 }, { userId: '2', ip: null }),
      ).rejects.toThrow('Audit insert failed');
    });

    it('状态校验：任务非在产抛 30003 INVALID_STATE_TRANSITION', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT work_order_id FROM work_task WHERE id = ?')) {
          return [{ work_order_id: '201' }];
        }
        if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
          return [{ id: '201', status: '在产', done_qty: 0 }];
        }
        if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
          return [{ id: '301', work_order_id: '201', seq: 10, status: '待启动', good_qty: 0, bad_qty: 0 }];
        }
        return [];
      });

      await expect(
        service.create({ taskId: '301', goodQty: 10, badQty: 0 }, { userId: '2', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('参数校验：良品与不良品和等于0抛 10001', async () => {
      const { service } = makeHarness();
      await expect(
        service.create({ taskId: '301', goodQty: 0, badQty: 0 }, { userId: '2', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    });

    it('累计容量溢出：累加超过 INT 上限抛 10003 INVALID_QUANTITY', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT work_order_id FROM work_task WHERE id = ?')) {
          return [{ work_order_id: '201' }];
        }
        if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
          return [{ id: '201', status: '在产', done_qty: 0 }];
        }
        if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
          return [{ id: '301', work_order_id: '201', seq: 10, status: '在产', good_qty: 2147483640, bad_qty: 0 }];
        }
        return [];
      });

      await expect(
        service.create({ taskId: '301', goodQty: 10, badQty: 0 }, { userId: '2', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_QUANTITY,
      });
    });
  });

  describe('列表查询（统一日期边界与口径一致）', () => {
    it('endDate 查询闭区间转换为次日 00:00:00 半开区间，且 count 与 rows 参数完全一致', async () => {
      const { service, queryLog } = makeHarness();

      const result = await service.list({
        startDate: '2026-10-09',
        endDate: '2026-10-09',
      });

      expect(result.total).toBe(1);
      expect(result.list).toHaveLength(1);

      const countCall = queryLog.find((q) => q.sql.includes('SELECT COUNT(*)'));
      const rowsCall = queryLog.find((q) => q.sql.includes('SELECT r.id, r.task_id'));

      expect(countCall).toBeDefined();
      expect(rowsCall).toBeDefined();

      // 参数：startDate 00:00:00, endDate次日 00:00:00
      expect(countCall?.params).toEqual(['2026-10-09 00:00:00', '2026-10-10 00:00:00']);
      // rowsCall 附带 take, skip
      expect(rowsCall?.params.slice(0, 2)).toEqual(['2026-10-09 00:00:00', '2026-10-10 00:00:00']);
    });

    it('非法日期或倒挂日期抛 10001 INVALID_ARGUMENT', async () => {
      const { service } = makeHarness();

      await expect(service.list({ startDate: '2026-02-31' })).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });

      await expect(
        service.list({ startDate: '2026-10-15', endDate: '2026-10-10' }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    });
  });
});
