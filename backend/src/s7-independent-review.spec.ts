import { describe, expect, it, vi } from 'vitest';
import { MetricsAggregationService } from './modules/dashboards/metrics-aggregation.service.js';
import { AlertsService } from './modules/alerts/alerts.service.js';

const snapshot = '2026-10-11T09:00:00.000+08:00';
const query = { startDate: '2026-10-09', endDate: '2026-10-09' };
const wo = { id: '1', qty: 100, plan_start: '2026-10-09', plan_end: '2026-10-09', prod_line: 'SMT-1线' };
function source(options: { missing?: number; orders?: any[]; good?: number; bad?: number; cumulative?: number } = {}) {
  return { query: vi.fn(async (sql: string) => {
    if (sql.includes('COUNT(DISTINCT wo.id)')) return [{ cnt: options.missing ?? 0 }];
    if (sql.includes('wo.plan_start <= ?')) return options.orders ?? [wo];
    if (sql.includes('FROM report r')) return [{ good_qty: options.good ?? 10, bad_qty: options.bad ?? 0, prod_line: 'SMT-1线' }];
    if (sql.includes('cumulative_good_qty')) return [{ work_order_id: '1', cumulative_good_qty: options.cumulative ?? 10 }];
    return [];
  }) };
}

describe('独立审查：S7未覆盖的契约边界（数据库替身，不是真实MySQL）', () => {
  it('Q6未批准时，流转应拒绝且不调用UPDATE', async () => {
    const manager = { query: vi.fn(async (sql: string) => sql.startsWith('SELECT') ? [{ id: '1', status: '未处理' }] : []) };
    const ds = { transaction: async (callback: any) => callback(manager) };
    const service = new AlertsService(ds as any, { write: vi.fn() } as any, {} as any);
    await expect(service.transitionState('1', { expectedStatus: '未处理', targetStatus: '已确认' }, { userId: '1', ip: null })).rejects.toMatchObject({ code: 30006 });
    expect(manager.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('历史累计量排除次日00:00:00报工', async () => {
    const ds = source();
    const base = ds.query.getMockImplementation()!;
    ds.query.mockImplementation(async (sql: string, ..._args: any[]) => {
      if (sql.includes('cumulative_good_qty')) {
        // 9日10件，10日零点5件；按服务实际SQL比较符评估边界。
        const inclusive = /r\.reported_at\s*<=\s*\?/.test(sql);
        return [{ work_order_id: '1', cumulative_good_qty: inclusive ? 15 : 10 }];
      }
      return base(sql);
    });
    const res = await new MetricsAggregationService(ds as any).getProductionMetrics(query, snapshot);
    expect(res.metrics.doneQty).toBe(10);
  });

  it('逆序工单计划应返回insufficient_data，不能抛普通Error导致500', async () => {
    const ds = source({ missing: 1, orders: [{ ...wo, plan_start: '2026-10-12', plan_end: '2026-10-10' }] });
    // 逆序区间仍满足现有SQL的 plan_start<=窗口末、plan_end>=窗口始。
    const res = await new MetricsAggregationService(ds as any).getProductionMetrics({ startDate: '2026-10-01', endDate: '2026-10-31' }, snapshot);
    expect(res.metrics.calculationStatus).toBe('insufficient_data');
    expect(res.metrics.completionRate).toBeNull();
  });

  it('缺失计划与合法计划混合时，不得基于局部集合形成交付预警', async () => {
    const ds = source({ missing: 1, good: 50, cumulative: 50 });
    const service = new MetricsAggregationService(ds as any);
    const res = await service.evaluateAlertRules(query, snapshot);
    expect(res.evaluations.find(e => e.ruleId === 'completionRate')?.triggered).toBe(false);
  });

  it('真实良品率96.996%低于97%，不得因显示舍入漏报', async () => {
    const ds = source({ good: 96996, bad: 3004, orders: [{ ...wo, qty: 100000 }], cumulative: 100000 });
    const res = await new MetricsAggregationService(ds as any).evaluateAlertRules(query, snapshot);
    expect(res.evaluations.find(e => e.ruleId === 'goodRate')?.triggered).toBe(true);
  });

  it('真实完成率89.996%低于90%，不得因显示舍入漏报', async () => {
    const ds = source({ good: 100000, bad: 0, orders: [{ ...wo, qty: 100000 }], cumulative: 89996 });
    const res = await new MetricsAggregationService(ds as any).evaluateAlertRules(query, snapshot);
    expect(res.evaluations.find(e => e.ruleId === 'completionRate')?.triggered).toBe(true);
  });

  it('单响应内执行时，应在同一只读事务快照下执行窗口与累计查询', async () => {
    const manager = {
      query: vi.fn(async (sql: string, ..._args: unknown[]) => {
        if (sql.includes('COUNT(DISTINCT wo.id)')) return [{ cnt: 0 }];
        if (sql.includes('wo.plan_start <= ?')) return [wo];
        if (sql.includes('FROM report r')) return [{ good_qty: 10, bad_qty: 0, prod_line: 'SMT-1线' }];
        if (sql.includes('cumulative_good_qty')) return [{ work_order_id: '1', cumulative_good_qty: 10 }];
        return [];
      }),
    };
    const ds = {
      query: vi.fn(async (sql: string, ...args: unknown[]) => manager.query(sql, ...args)),
      transaction: vi.fn(async (...args: any[]) => {
        const cb = typeof args[0] === 'function' ? args[0] : args[1];
        return cb(manager);
      }),
    };
    const res = await new MetricsAggregationService(ds as any).getProductionMetrics(query, '2026-10-09T09:00:00.500+08:00');
    expect(ds.transaction).toHaveBeenCalled();
    expect(res.metrics.doneQty).toBe(10);
  });

  it('U1: 缺计划检查、候选集合、窗口与累计查询必须全部在事务执行器内执行，避免事务外脏读导致insufficient_data', async () => {
    // 模拟审查探针：如果缺计划检查在事务外执行（ds.query），返回旧版本(缺计划 cnt=1)；
    // 而在事务内（manager.query），管理员已补齐计划，看到一致的有效计划与无报工零进度(cnt=0)
    const manager = {
      query: vi.fn(async (sql: string, ..._args: unknown[]) => {
        if (sql.includes('COUNT(DISTINCT wo.id)')) return [{ cnt: 0 }];
        if (sql.includes('wo.plan_start <= ?')) return [wo];
        if (sql.includes('FROM report r')) return [];
        if (sql.includes('cumulative_good_qty')) return [{ work_order_id: '1', cumulative_good_qty: 0 }];
        return [];
      }),
    };
    const ds = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('COUNT(DISTINCT wo.id)')) return [{ cnt: 1 }]; // 事务外旧数据
        return [];
      }),
      transaction: vi.fn(async (...args: any[]) => {
        expect(args[0]).toBe('REPEATABLE READ');
        const cb = typeof args[0] === 'function' ? args[0] : args[1];
        return cb(manager);
      }),
    };

    const service = new MetricsAggregationService(ds as any);
    const res = await service.getProductionMetrics(query, snapshot);

    expect(ds.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(ds.query).not.toHaveBeenCalled(); // 事务外绝不发起查询
    expect(res.metrics.calculationStatus).toBe('available');
    expect(res.metrics.completionRate).toBe(0);
  });

  it('指定隔离级别失败时，异常必须向上传播，绝不得捕获后静默降级重跑', async () => {
    const ds = {
      transaction: vi.fn(async (isolation: string, cb: any) => {
        if (isolation === 'REPEATABLE READ') {
          throw new Error('Driver does not support REPEATABLE READ');
        }
        return cb({});
      }),
    };
    const service = new MetricsAggregationService(ds as any);
    await expect(service.getProductionMetrics(query, snapshot)).rejects.toThrow('Driver does not support REPEATABLE READ');
    expect(ds.transaction).toHaveBeenCalledTimes(1); // 绝不二次调用降级重跑
  });

  it('事务内查询抛错时，异常必须向上传播，绝不得吞掉异常或重跑事务', async () => {
    let callCount = 0;
    const manager = {
      query: vi.fn(async () => {
        throw new Error('Deadlock detected or Query syntax error');
      }),
    };
    const ds = {
      transaction: vi.fn(async (_isolation: string, cb: any) => {
        callCount++;
        return cb(manager);
      }),
    };
    const service = new MetricsAggregationService(ds as any);
    await expect(service.getProductionMetrics(query, snapshot)).rejects.toThrow('Deadlock detected or Query syntax error');
    expect(callCount).toBe(1); // 绝不重跑
  });

  describe('本轮独立：累计量不能由窗口量猜测快照', () => {
    function round2Source(windowGood: number, cumulative: number) {
      return { query: vi.fn(async (sql: string) => {
        if (sql.includes('COUNT(DISTINCT wo.id)')) return [{ cnt: 0 }];
        if (sql.includes('wo.plan_start <= ?')) return [{ id: '1', qty: 100, plan_start: '2026-10-09', plan_end: '2026-10-09', prod_line: 'SMT-1线' }];
        if (sql.includes('FROM report r')) return windowGood === 0 ? [] : [{ work_order_id: '1', good_qty: windowGood, bad_qty: 0, prod_line: 'SMT-1线' }];
        if (sql.includes('cumulative_good_qty')) return [{ work_order_id: '1', cumulative_good_qty: cumulative }];
        return [];
      }) };
    }

    it('同一静态数据集：窗口前50件、窗口内26件，累计应76而不是26', async () => {
      // 计划日期不约束报工时间。任务已在产，8日报50件、9日报26件；两次读取都准确且无并发。
      const service = new MetricsAggregationService(round2Source(26, 76) as any);
      const res = await service.getProductionMetrics({ startDate: '2026-10-09', endDate: '2026-10-09' }, '2026-10-11T09:00:00.000+08:00');
      expect(res.metrics.goodQty).toBe(26);
      expect(res.metrics.doneQty).toBe(76);
      expect(res.metrics.completionRate).toBe(76);
    });

    it('今天查询工单累计量：昨日50件、今日26件，累计应76件且不被当日窗口量覆盖', async () => {
      // 计划日期在今天，昨日已有历史累计50件，今日产出26件；查询今天，累计严格保持76件
      const service = new MetricsAggregationService(round2Source(26, 76) as any);
      const res = await service.getProductionMetrics({ startDate: '2026-10-09', endDate: '2026-10-09' }, '2026-10-09T09:00:00.500+08:00');
      expect(res.metrics.goodQty).toBe(26);
      expect(res.metrics.doneQty).toBe(76);
      expect(res.metrics.completionRate).toBe(76);
    });

    it('计划横跨窗口时，保持契约累计口径由 cumulativeMap 提供', async () => {
      const ds = round2Source(10, 20);
      const base = ds.query.getMockImplementation()!;
      ds.query.mockImplementation(async (sql: string) => sql.includes('wo.plan_start <= ?')
        ? [{ id: '1', qty: 100, plan_start: '2026-10-08', plan_end: '2026-10-10', prod_line: 'SMT-1线' }]
        : base(sql));
      const res = await new MetricsAggregationService(ds as any).getProductionMetrics({ startDate: '2026-10-09', endDate: '2026-10-09' }, '2026-10-09T09:00:00.500+08:00');
      expect(res.metrics.goodQty).toBe(10);
      expect(res.metrics.doneQty).toBe(20);
    });
  });

  describe('返修项：DTO 参数校验与未分配钻取匹配', () => {
    it('报工与质检 DTO 必须拒绝非字符串或重复参数（如数组）', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { ListReportsQueryDto } = await import('./modules/reports/dto/list-reports-query.dto.js');
      const { ListQualityInspectionsQueryDto } = await import('./modules/quality-inspections/dto/list-quality-inspections-query.dto.js');
      const { ListWorkOrdersQueryDto } = await import('./modules/work-orders/dto/list-work-orders-query.dto.js');

      const repDto = plainToInstance(ListReportsQueryDto, { prodLine: ['SMT-1线', 'SMT-2线'] });
      const repErrors = await validate(repDto);
      expect(repErrors.some((e) => e.property === 'prodLine')).toBe(true);

      const qcDto = plainToInstance(ListQualityInspectionsQueryDto, { prodLine: ['SMT-1线', 'SMT-2线'] });
      const qcErrors = await validate(qcDto);
      expect(qcErrors.some((e) => e.property === 'prodLine')).toBe(true);

      const woDto = plainToInstance(ListWorkOrdersQueryDto, { prodLine: ['SMT-1线', 'SMT-2线'] });
      const woErrors = await validate(woDto);
      expect(woErrors.some((e) => e.property === 'prodLine')).toBe(true);
    });

    it('报工与质检服务查询“未分配”产线时，必须匹配 NULL 或空值产线', async () => {
      const { ReportsService } = await import('./modules/reports/reports.service.js');
      const { QualityInspectionsService } = await import('./modules/quality-inspections/quality-inspections.service.js');

      const capturedSqls: string[] = [];
      const ds = {
        query: vi.fn(async (sql: string) => {
          capturedSqls.push(sql);
          if (sql.includes('COUNT(*)')) return [{ total: 0 }];
          return [];
        }),
      };

      const repService = new ReportsService(ds as any, { write: vi.fn() } as any);
      await repService.list({ prodLine: '未分配', page: '1', pageSize: '20' });
      expect(capturedSqls.some((sql) => sql.includes('t.prod_line IS NULL OR t.prod_line = "" OR t.prod_line = "未分配"'))).toBe(true);

      capturedSqls.length = 0;
      const qcService = new QualityInspectionsService(ds as any, { write: vi.fn() } as any);
      await qcService.list({ prodLine: '未分配', page: '1', pageSize: '20' });
      expect(capturedSqls.some((sql) => sql.includes('t.prod_line IS NULL OR t.prod_line = "" OR t.prod_line = "未分配"'))).toBe(true);
    });

    it('工单列表服务查询产线与“未分配”时，必须关联末道任务精确过滤且不得使用OR EXISTS扩大范围', async () => {
      const { WorkOrdersService } = await import('./modules/work-orders/work-orders.service.js');

      const capturedSqls: string[] = [];
      const ds = {
        query: vi.fn(async (sql: string) => {
          capturedSqls.push(sql);
          if (sql.includes('COUNT(')) return [{ total: 0 }];
          return [];
        }),
      };

      const woService = new WorkOrdersService(ds as any, { write: vi.fn() } as any);
      await woService.list({ prodLine: 'SMT-1线', page: '1', pageSize: '20' });
      expect(capturedSqls.some((sql) => sql.includes('last_task.prod_line = ?'))).toBe(true);
      expect(capturedSqls.some((sql) => sql.includes('EXISTS'))).toBe(false);

      capturedSqls.length = 0;
      await woService.list({ prodLine: 'SMT-2线', workshop: '装配车间', page: '1', pageSize: '20' });
      expect(capturedSqls.some((sql) => sql.includes('last_task.prod_line = ? AND last_task.workshop = ?'))).toBe(true);
      expect(capturedSqls.some((sql) => sql.includes('EXISTS'))).toBe(false);

      capturedSqls.length = 0;
      await woService.list({ prodLine: '未分配', page: '1', pageSize: '20' });
      expect(capturedSqls.some((sql) => sql.includes('last_task.prod_line IS NULL') || sql.includes('last_task.prod_line = "未分配"'))).toBe(true);
      expect(capturedSqls.some((sql) => sql.includes('EXISTS'))).toBe(false);
    });
  });
});

