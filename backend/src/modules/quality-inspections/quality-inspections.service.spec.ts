import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { QualityInspectionsService } from './quality-inspections.service.js';

interface Harness {
  service: QualityInspectionsService;
  queryLog: Array<{ sql: string; params: unknown[] }>;
}

function makeHarness(customQuery?: (sql: string, params: unknown[]) => Promise<unknown>): Harness {
  const queryLog: Array<{ sql: string; params: unknown[] }> = [];

  const defaultQuery = async (sql: string, params: unknown[] = []) => {
    queryLog.push({ sql, params });

    // Validate workOrder
    if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
      return [{ id: '201', code: 'WO-20261009-001', status: '在产' }];
    }
    // Validate task
    if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
      return [{ id: '301', work_order_id: '201', step_name: '回流焊接' }];
    }
    // Insert qc_record
    if (sql.includes('INSERT INTO qc_record')) {
      return { insertId: 501 };
    }
    // Insert defect
    if (sql.includes('INSERT INTO defect')) {
      return { insertId: 601 };
    }
    // Read qc_record with epoch
    if (sql.includes('FROM qc_record r WHERE id = ?')) {
      return [
        {
          id: 501,
          work_order_id: 201,
          task_id: 301,
          result: 'NG',
          check_qty: 80,
          ng_qty: 4,
          inspector_id: 3,
          remark: null,
          checked_at_epoch: 1770000000,
        },
      ];
    }
    // Read defect list for findOne
    if (sql.includes('FROM defect WHERE qc_record_id = ?')) {
      return [
        {
          id: 601,
          qc_record_id: 501,
          defect_type: '虚焊',
          qty: 4,
          step_name: '回流焊接',
          description: null,
        },
      ];
    }
    // Count qc_record
    if (sql.includes('SELECT COUNT(*) AS total FROM qc_record')) {
      return [{ total: 1 }];
    }
    // List qc_record
    if (sql.includes('FROM qc_record r') && sql.includes('LIMIT ? OFFSET ?')) {
      return [
        {
          id: 501,
          work_order_id: 201,
          task_id: 301,
          result: 'NG',
          check_qty: 80,
          ng_qty: 4,
          inspector_id: 3,
          remark: null,
          checked_at_epoch: 1770000000,
        },
      ];
    }
    // Defects for list
    if (sql.includes('FROM defect WHERE qc_record_id IN')) {
      return [
        {
          id: 601,
          qc_record_id: 501,
          defect_type: '虚焊',
          qty: 4,
          step_name: '回流焊接',
          description: null,
        },
      ];
    }
    // Defect count & list
    if (sql.includes('SELECT COUNT(*) AS total FROM defect')) {
      return [{ total: 1 }];
    }
    if (sql.includes('FROM defect d') && sql.includes('LIMIT ? OFFSET ?')) {
      return [
        {
          id: 601,
          qc_record_id: 501,
          defect_type: '虚焊',
          qty: 4,
          step_name: '回流焊接',
          description: null,
          created_at_epoch: 1770000000,
        },
      ];
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

  const service = new QualityInspectionsService(dataSource as never, audit as never);
  return { service, queryLog };
}

describe('QualityInspectionsService —— B4 质量检验', () => {
  describe('创建检验记录（服务级流程闭环与异常传播）', () => {
    it('统一锁顺序：质检先锁工单 FOR UPDATE，后锁任务 FOR UPDATE（与报工全局锁顺序一致，防死锁）', async () => {
      const { service, queryLog } = makeHarness();

      await service.create(
        {
          workOrderId: '201',
          taskId: '301',
          result: 'OK',
          checkQty: 100,
          ngQty: 0,
        },
        { userId: '1', ip: null },
      );

      const woLockIdx = queryLog.findIndex((q) => q.sql.includes('FROM work_order WHERE id = ? FOR UPDATE'));
      const taskLockIdx = queryLog.findIndex((q) => q.sql.includes('FROM work_task WHERE id = ? FOR UPDATE'));

      expect(woLockIdx).toBeGreaterThanOrEqual(0);
      expect(taskLockIdx).toBeGreaterThanOrEqual(0);
      expect(woLockIdx).toBeLessThan(taskLockIdx);
    });

    it('OK 检验：ngQty 为 0 且无 defects，成功写入', async () => {
      const { service, queryLog } = makeHarness(async (sql) => {
        if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
          return [{ id: '201', code: 'WO-20261009-001', status: '在产' }];
        }
        if (sql.includes('INSERT INTO qc_record')) return { insertId: 502 };
        if (sql.includes('FROM qc_record r WHERE id = ?')) {
          return [
            {
              id: 502,
              work_order_id: 201,
              task_id: null,
              result: 'OK',
              check_qty: 100,
              ng_qty: 0,
              inspector_id: 1,
              remark: '全部合格',
              checked_at_epoch: 1770000000,
            },
          ];
        }
        return [];
      });

      const res = await service.create(
        {
          workOrderId: '201',
          result: 'OK',
          checkQty: 100,
          ngQty: 0,
          remark: '全部合格',
        },
        { userId: '1', ip: null },
      );

      expect(res.id).toBe('502');
      expect(res.result).toBe('OK');
      expect(res.ngQty).toBe(0);
      expect(res.defects).toBeUndefined();

      // 未插入 defect 表
      const defectInsert = queryLog.find((q) => q.sql.includes('INSERT INTO defect'));
      expect(defectInsert).toBeUndefined();
    });

    it('NG 检验：同一事务写入 qc_record 与 defect 记录', async () => {
      const { service, queryLog } = makeHarness();

      const res = await service.create(
        {
          workOrderId: '201',
          taskId: '301',
          result: 'NG',
          checkQty: 80,
          ngQty: 4,
          defects: [{ defectType: '虚焊', qty: 4 }],
        },
        { userId: '3', ip: '127.0.0.1' },
      );

      expect(res.id).toBe('501');
      expect(res.result).toBe('NG');
      expect(res.defects).toHaveLength(1);
      expect(res.defects?.[0]?.defectType).toBe('虚焊');
      expect(res.defects?.[0]?.stepName).toBe('回流焊接');

      const qcInsert = queryLog.find((q) => q.sql.includes('INSERT INTO qc_record'));
      const defInsert = queryLog.find((q) => q.sql.includes('INSERT INTO defect'));
      expect(qcInsert).toBeDefined();
      expect(defInsert).toBeDefined();
    });

    it('服务级故障传播：若 defect 插入失败，事务中断并向外传播错误', async () => {
      const manager = {
        query: async (sql: string) => {
          if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
            return [{ id: '201', code: 'WO-1', status: '在产' }];
          }
          if (sql.includes('INSERT INTO qc_record')) {
            return { insertId: 503 };
          }
          if (sql.includes('INSERT INTO defect')) {
            throw new Error('Defect table deadlocked');
          }
          return [];
        },
      };

      const dataSource = {
        transaction: async (work: (m: unknown) => Promise<unknown>) => work(manager),
        query: async () => [],
      };
      const audit = { write: async () => undefined };

      const service = new QualityInspectionsService(dataSource as never, audit as never);

      await expect(
        service.create(
          {
            workOrderId: '201',
            result: 'NG',
            checkQty: 10,
            ngQty: 2,
            defects: [{ defectType: '错件', qty: 2 }],
          },
          { userId: '1', ip: null },
        ),
      ).rejects.toThrow('Defect table deadlocked');
    });

    it('关联任务不属于工单时抛 10002 INVALID_REFERENCE', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('FROM work_order WHERE id = ? FOR UPDATE')) {
          return [{ id: '201', code: 'WO-1', status: '在产' }];
        }
        if (sql.includes('FROM work_task WHERE id = ? FOR UPDATE')) {
          // 该任务属于工单 999，而非 201
          return [{ id: '301', work_order_id: '999', step_name: '测试' }];
        }
        return [];
      });

      await expect(
        service.create(
          {
            workOrderId: '201',
            taskId: '301',
            result: 'OK',
            checkQty: 10,
            ngQty: 0,
          },
          { userId: '1', ip: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_REFERENCE,
      });
    });

    it('NG 明细数量之和不等于 ngQty 时抛 10003 INVALID_QUANTITY', async () => {
      const { service } = makeHarness();

      await expect(
        service.create(
          {
            workOrderId: '201',
            result: 'NG',
            checkQty: 10,
            ngQty: 5,
            defects: [{ defectType: '虚焊', qty: 3 }], // 3 != 5
          },
          { userId: '1', ip: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_QUANTITY,
      });
    });
  });

  describe('详情与边界校验（findOne）', () => {
    it('非法 BIGINT ID（如 0、负数、超 BIGINT 上限）直接抛 10001', async () => {
      const { service } = makeHarness();

      await expect(service.findOne('0')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
      await expect(service.findOne('-5')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
      await expect(service.findOne('9223372036854775808')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
      await expect(service.findOne('abc')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    });

    it('有效 ID 成功返回包含 defects 的完整质检对象', async () => {
      const { service } = makeHarness();

      const item = await service.findOne('501');
      expect(item.id).toBe('501');
      expect(item.result).toBe('NG');
      expect(item.defects).toHaveLength(1);
      expect(item.defects?.[0]?.defectType).toBe('虚焊');
      expect(item.checkedAt).toContain('2026-');
    });
  });

  describe('列表查询（统一日期边界）', () => {
    it('endDate 查询参数闭区间转为次日 00:00:00 半开区间', async () => {
      const { service, queryLog } = makeHarness();

      const result = await service.list({
        startDate: '2026-10-09',
        endDate: '2026-10-09',
      });

      expect(result.total).toBe(1);

      const countCall = queryLog.find((q) => q.sql.includes('SELECT COUNT(*) AS total FROM qc_record'));
      expect(countCall?.params).toEqual(['2026-10-09 00:00:00', '2026-10-10 00:00:00']);
    });

    it('不良列表 listDefects 正确支持筛选与半开区间查询', async () => {
      const { service, queryLog } = makeHarness();

      const defects = await service.listDefects({
        startDate: '2026-10-09',
        endDate: '2026-10-09',
        defectType: '虚焊',
      });

      expect(defects.total).toBe(1);
      expect(defects.list[0]?.defectType).toBe('虚焊');

      const countCall = queryLog.find((q) => q.sql.includes('SELECT COUNT(*) AS total FROM defect'));
      expect(countCall?.params).toEqual(['虚焊', '2026-10-09 00:00:00', '2026-10-10 00:00:00']);
    });
  });
});
