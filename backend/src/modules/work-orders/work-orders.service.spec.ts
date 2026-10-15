import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { WorkOrdersService } from './work-orders.service.js';

interface Harness {
  service: WorkOrdersService;
  queryLog: Array<{ sql: string; params: unknown[] }>;
  setWorkOrder: (wo: any) => void;
}

function makeHarness(customQuery?: (sql: string, params: unknown[]) => Promise<unknown>): Harness {
  const queryLog: Array<{ sql: string; params: unknown[] }> = [];

  const defaultQuery = async (sql: string, params: unknown[] = []) => {
    queryLog.push({ sql, params });

    // Lock task
    if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
      return [
        {
          id: '101',
          work_order_id: '201',
          seq: 1,
          step_name: '锡膏印刷',
          workshop: '一车间',
          prod_line: 'SMT-1线',
          device_code: 'EQP-SMT-001',
          operator_id: '1',
          status: '待启动',
          plan_qty: 100,
          good_qty: 0,
          bad_qty: 0,
          plan_start: '2026-10-10 08:00:00',
          plan_end: '2026-10-10 12:00:00',
        },
      ];
    }

    // Lock work order
    if (sql.includes('FROM work_order') && sql.includes('FOR UPDATE')) {
      return [{ id: '201', code: 'WO-20261010-001', status: '待启动', done_qty: 0 }];
    }

    // Workshop & prod line check
    if (sql.includes('FROM device WHERE workshop = ? AND prod_line = ?')) {
      return [{ 1: 1 }];
    }

    // Device check
    if (sql.includes('SELECT status, prod_line, workshop FROM device WHERE code = ?')) {
      return [{ status: '运行中', prod_line: 'SMT-1线', workshop: '一车间' }];
    }

    // User check
    if (sql.includes('SELECT enabled FROM sys_user WHERE id = ?')) {
      return [{ enabled: 1 }];
    }

    // Task read (findTask)
    if (sql.includes('FROM work_task t') && sql.includes('WHERE t.id = ?')) {
      return [
        {
          id: '101',
          work_order_id: '201',
          seq: 1,
          step_name: '锡膏印刷',
          workshop: '一车间',
          prod_line: 'SMT-1线',
          device_code: 'EQP-SMT-001',
          operator_id: '1',
          status: '待启动',
          plan_qty: 100,
          good_qty: 0,
          bad_qty: 0,
          plan_start: '2026-10-10 08:00:00',
          plan_end: '2026-10-10 12:00:00',
          started_at: null,
          finished_at: null,
        },
      ];
    }

    return [];
  };

  const queryFn = customQuery || defaultQuery;

  let currentWorkOrder: any = { id: '201', code: 'WO-20261010-001', status: '在产', done_qty: 0 };

  const manager = {
    query: vi.fn(queryFn),
    update: vi.fn(async () => ({ affected: 1 })),
    createQueryBuilder: vi.fn(() => ({
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => currentWorkOrder),
    })),
  };

  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) => work(manager),
    query: vi.fn(queryFn),
  };

  const audit = {
    write: vi.fn(async () => undefined),
  };

  const service = new WorkOrdersService(dataSource as never, audit as never);
  return {
    service,
    queryLog,
    setWorkOrder: (wo: any) => {
      currentWorkOrder = wo;
    },
  };
}

describe('WorkOrdersService', () => {
  describe('任务分配规则校验（updateTask）', () => {
    it('产线车间范围校验：产线不属于任务所属车间时抛 10002 INVALID_REFERENCE', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
          return [
            {
              id: '101',
              workshop: '一车间',
              prod_line: 'SMT-1线',
              device_code: null,
              operator_id: null,
              plan_start: null,
              plan_end: null,
            },
          ];
        }
        // 车间产线查询返回空（产线不属于车间）
        if (sql.includes('FROM device WHERE workshop = ? AND prod_line = ?')) {
          return [];
        }
        return [];
      });

      await expect(
        service.updateTask('101', { prodLine: 'ASSY-1线' }, { userId: '1', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_REFERENCE,
        message: expect.stringContaining('产线不属于任务所在车间'),
      });
    });

    it('仅修改产线时联动校验已有设备：当已有 deviceCode 与新 prodLine 不一致时抛 10002', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
          return [
            {
              id: '101',
              workshop: '一车间',
              prod_line: 'SMT-1线',
              device_code: 'EQP-SMT-001', // SMT-1线的设备
              operator_id: null,
              plan_start: null,
              plan_end: null,
            },
          ];
        }
        // SMT-2线属于一车间
        if (sql.includes('FROM device WHERE workshop = ? AND prod_line = ?')) {
          return [{ 1: 1 }];
        }
        // 查询已有设备 EQP-SMT-001，其产线仍为 SMT-1线
        if (sql.includes('SELECT status, prod_line, workshop FROM device WHERE code = ?')) {
          return [{ status: '运行中', prod_line: 'SMT-1线', workshop: '一车间' }];
        }
        return [];
      });

      // 仅修改 prodLine 为 SMT-2线，没有传 deviceCode，但任务已有 EQP-SMT-001
      await expect(
        service.updateTask('101', { prodLine: 'SMT-2线' }, { userId: '1', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_REFERENCE,
        message: expect.stringContaining('设备所属产线与任务产线不一致'),
      });
    });

    it('设备状态校验：分配维修中设备抛 30003 INVALID_STATE_TRANSITION', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
          return [
            {
              id: '101',
              workshop: '一车间',
              prod_line: 'SMT-1线',
              device_code: null,
              operator_id: null,
              plan_start: null,
              plan_end: null,
            },
          ];
        }
        if (sql.includes('FROM device WHERE workshop = ? AND prod_line = ?')) {
          return [{ 1: 1 }];
        }
        if (sql.includes('SELECT status, prod_line, workshop FROM device WHERE code = ?')) {
          return [{ status: '维修中', prod_line: 'SMT-1线', workshop: '一车间' }];
        }
        return [];
      });

      await expect(
        service.updateTask('101', { deviceCode: 'EQP-SMT-006' }, { userId: '1', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
        message: expect.stringContaining('设备当前状态不是运行中'),
      });
    });

    it('设备车间校验：分配跨车间设备抛 10002 INVALID_REFERENCE', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
          return [
            {
              id: '101',
              workshop: '一车间',
              prod_line: null,
              device_code: null,
              operator_id: null,
              plan_start: null,
              plan_end: null,
            },
          ];
        }
        if (sql.includes('SELECT status, prod_line, workshop FROM device WHERE code = ?')) {
          return [{ status: '运行中', prod_line: 'ASSY-1线', workshop: '二车间' }];
        }
        return [];
      });

      await expect(
        service.updateTask('101', { deviceCode: 'EQP-ASSY-001' }, { userId: '1', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_REFERENCE,
        message: expect.stringContaining('设备所属车间与任务车间不一致'),
      });
    });

    it('操作员可用性校验：未启用操作员抛 10002 INVALID_REFERENCE', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
          return [
            {
              id: '101',
              workshop: '一车间',
              prod_line: 'SMT-1线',
              device_code: null,
              operator_id: null,
              plan_start: null,
              plan_end: null,
            },
          ];
        }
        if (sql.includes('SELECT enabled FROM sys_user WHERE id = ?')) {
          return [{ enabled: 0 }];
        }
        return [];
      });

      await expect(
        service.updateTask('101', { operatorId: '99' }, { userId: '1', ip: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_REFERENCE,
        message: expect.stringContaining('操作员未启用'),
      });
    });

    it('时间校验：计划开始时间晚于计划结束时间抛 10001 INVALID_ARGUMENT', async () => {
      const { service } = makeHarness(async (sql) => {
        if (sql.includes('SELECT * FROM work_task WHERE id = ? FOR UPDATE')) {
          return [
            {
              id: '101',
              workshop: '一车间',
              prod_line: 'SMT-1线',
              device_code: null,
              operator_id: null,
              plan_start: null,
              plan_end: null,
            },
          ];
        }
        return [];
      });

      await expect(
        service.updateTask(
          '101',
          { planStart: '2026-10-10 12:00:00', planEnd: '2026-10-10 08:00:00' },
          { userId: '1', ip: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    });

    it('合法分配：校验通过并写入数据库与审计日志', async () => {
      const { service, queryLog } = makeHarness();

      const result = await service.updateTask(
        '101',
        {
          prodLine: 'SMT-1线',
          deviceCode: 'EQP-SMT-001',
          operatorId: '1',
          planStart: '2026-10-10 08:00:00',
          planEnd: '2026-10-10 12:00:00',
        },
        { userId: '1', ip: '127.0.0.1' },
      );

      expect(result.id).toBe('101');
      const updateQuery = queryLog.find((q) => q.sql.includes('UPDATE work_task SET'));
      expect(updateQuery).toBeDefined();
    });
  });

  describe('工单状态流转（transitionWorkOrder）', () => {
    it('Q2-1 已批准流转：在产 → 暂停、暂停 → 在产、待启动 → 关闭、在产 → 关闭、暂停 → 关闭 成功', async () => {
      const approvedCases = [
        { current: '在产', target: '暂停' },
        { current: '暂停', target: '在产' },
        { current: '待启动', target: '关闭' },
        { current: '在产', target: '关闭' },
        { current: '暂停', target: '关闭' },
      ];

      for (const { current, target } of approvedCases) {
        const { service, setWorkOrder } = makeHarness();
        setWorkOrder({ id: '201', code: 'WO-1', status: current, done_qty: 0 });

        const res = await service.transitionWorkOrder(
          '201',
          { expectedStatus: current as never, targetStatus: target as never },
          { userId: '1', ip: null },
        );
        expect(res.status).toBe(target);
      }
    });

    it('非法流转：待启动 → 暂停抛 30003 INVALID_STATE_TRANSITION', async () => {
      const { service, setWorkOrder } = makeHarness();
      setWorkOrder({ id: '201', code: 'WO-1', status: '待启动', done_qty: 0 });

      await expect(
        service.transitionWorkOrder(
          '201',
          { expectedStatus: '待启动' as never, targetStatus: '暂停' as never },
          { userId: '1', ip: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('终态不可流转：完工 → 关闭抛 30003 INVALID_STATE_TRANSITION', async () => {
      const { service, setWorkOrder } = makeHarness();
      setWorkOrder({ id: '201', code: 'WO-1', status: '完工', done_qty: 100 });

      await expect(
        service.transitionWorkOrder(
          '201',
          { expectedStatus: '完工' as never, targetStatus: '关闭' as never },
          { userId: '1', ip: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });
  });
});
