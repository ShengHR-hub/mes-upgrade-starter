import { describe, expect, it, vi } from 'vitest';

import { MetricsAggregationService } from './metrics-aggregation.service.js';

describe('MetricsAggregationService (契约 §6.8 / B8 经营驾驶舱)', () => {
  const snapshotAt = '2026-10-09T09:00:00+08:00';

  it('100件7天分摊与首日完成率：完成率76%，报工良品率95%，isTrueFpy=false', async () => {
    // 模拟契约 §6.8 官方数值示例：
    // 工单 qty=100, 2026-10-09~2026-10-15 (7天)
    // 09日当日报工良品76, 不良4 (output=80, goodRate=95%)
    // 截至09日09:00累计良品76, 计划总数100 (completionRate=76%)
    const customQuery = async (sql: string, _params: unknown[] = []) => {
      // 检查缺失计划
      if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) {
        return [{ cnt: 0 }];
      }
      // 候选工单查询
      if (sql.includes('FROM work_order wo') && sql.includes('wo.plan_start <= ?')) {
        return [
          {
            id: '201',
            code: 'WO-20261009-001',
            product_code: 'JC-PLC-2001',
            qty: 100,
            done_qty: 76,
            plan_start: '2026-10-09',
            plan_end: '2026-10-15',
            workshop: '一车间',
            prod_line: 'SMT-3',
          },
        ];
      }
      // 窗口末道报工查询
      if (sql.includes('FROM report r') && sql.includes('last_task.seq = wt.seq')) {
        return [
          {
            good_qty: 76,
            bad_qty: 4,
            reported_at_epoch: 1791507600,
            prod_line: 'SMT-3',
            workshop: '一车间',
            work_order_id: '201',
          },
        ];
      }
      // 累计良品重建查询
      if (sql.includes('SUM(r.good_qty)') && sql.includes('GROUP BY wo.id')) {
        return [
          {
            work_order_id: '201',
            cumulative_good_qty: 76,
          },
        ];
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getProductionMetrics(
      {
        startDate: '2026-10-09',
        endDate: '2026-10-09',
      },
      snapshotAt,
    );

    expect(res.startDate).toBe('2026-10-09');
    expect(res.endDate).toBe('2026-10-09');
    expect(res.snapshotAt).toBe(snapshotAt);
    expect(res.metrics.planQty).toBe(14); // 100分7天首日=14
    expect(res.metrics.planTotalQty).toBe(100);
    expect(res.metrics.doneQty).toBe(76);
    expect(res.metrics.outputQty).toBe(80);
    expect(res.metrics.goodQty).toBe(76);
    expect(res.metrics.badQty).toBe(4);
    expect(res.metrics.completionRate).toBe(76); // 76 / 100 * 100
    expect(res.metrics.goodRate).toBe(95); // 76 / 80 * 100
    expect(res.metrics.isTrueFpy).toBe(false);
    expect(res.metrics.calculationStatus).toBe('available');
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toMatchObject({
      prodLine: 'SMT-3',
      planQty: 14,
      planTotalQty: 100,
      doneQty: 76,
      outputQty: 80,
      goodQty: 76,
      badQty: 4,
      completionRate: 76,
      goodRate: 95,
    });
  });

  it('S9 P2-1：prodLines（别名解析后的实际名称集合）走 IN 过滤，prodLine 单值语义不变', async () => {
    const seenParams: unknown[][] = [];
    const customQuery = async (sql: string, params: unknown[] = []) => {
      seenParams.push(params);
      if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) {
        return [{ cnt: 0 }];
      }
      if (sql.includes('FROM work_order wo') && sql.includes('wo.plan_start <= ?')) {
        // 仅在 IN 过滤命中 SMT-2线 时返回工单
        if (sql.includes('last_task.prod_line IN (?)')) {
          return [
            {
              id: '201',
              code: 'WO-20261009-001',
              product_code: 'JC-PLC-2001',
              qty: 100,
              done_qty: 76,
              plan_start: '2026-10-09',
              plan_end: '2026-10-15',
              workshop: '一车间',
              prod_line: 'SMT-2线',
            },
          ];
        }
        return [];
      }
      if (sql.includes('FROM report r') && sql.includes('last_task.seq = wt.seq')) {
        if (sql.includes('last_task.prod_line IN (?)')) {
          return [
            {
              good_qty: 76,
              bad_qty: 4,
              reported_at_epoch: 1791507600,
              prod_line: 'SMT-2线',
              workshop: '一车间',
              work_order_id: '201',
            },
          ];
        }
        return [];
      }
      if (sql.includes('SUM(r.good_qty)') && sql.includes('GROUP BY wo.id')) {
        return [{ work_order_id: '201', cumulative_good_qty: 76 }];
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getProductionMetrics(
      {
        startDate: '2026-10-09',
        endDate: '2026-10-09',
        prodLines: ['SMT-2线'],
      } as any,
      snapshotAt,
    );

    expect(res.metrics.planTotalQty).toBe(100);
    expect(res.metrics.goodRate).toBe(95);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].prodLine).toBe('SMT-2线');
    // 候选工单与窗口报工查询都带上了实际名称参数
    const candidateCall = seenParams.find((p) => p.includes('SMT-2线'));
    expect(candidateCall).toBeDefined();
  });

  it('跨产线汇总先合计数量再算比率，不平均产线百分比', async () => {
    // 线 A: 10 件良品 / 10 产量 = 100%
    // 线 B: 10 件良品 / 30 产量 = 33.33%
    // 算术平均为 (100 + 33.33)/2 = 66.67%
    // 正确跨线加权为 (10 + 10) / (10 + 30) = 20 / 40 = 50%
    const customQuery = async (sql: string) => {
      if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) return [{ cnt: 0 }];
      if (sql.includes('FROM work_order wo') && sql.includes('wo.plan_start <= ?')) {
        return [
          {
            id: '1',
            qty: 100,
            plan_start: '2026-10-09',
            plan_end: '2026-10-09',
            prod_line: 'Line-A',
          },
          {
            id: '2',
            qty: 200,
            plan_start: '2026-10-09',
            plan_end: '2026-10-09',
            prod_line: 'Line-B',
          },
        ];
      }
      if (sql.includes('FROM report r') && sql.includes('last_task.seq = wt.seq')) {
        return [
          { good_qty: 10, bad_qty: 0, prod_line: 'Line-A', work_order_id: '1' },
          { good_qty: 10, bad_qty: 20, prod_line: 'Line-B', work_order_id: '2' },
        ];
      }
      if (sql.includes('SUM(r.good_qty)') && sql.includes('GROUP BY wo.id')) {
        return [
          { work_order_id: '1', cumulative_good_qty: 10 },
          { work_order_id: '2', cumulative_good_qty: 10 },
        ];
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09' },
      snapshotAt,
    );

    // 跨线良品率加权：20 / 40 = 50%
    expect(res.metrics.goodRate).toBe(50);
    // 跨线完成率加权：(10 + 10) / (100 + 200) = 20 / 300 = 6.67%
    expect(res.metrics.completionRate).toBe(6.67);
  });

  it('有效计划且无报工：完成率 0，良品率 null', async () => {
    const customQuery = async (sql: string) => {
      if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) return [{ cnt: 0 }];
      if (sql.includes('FROM work_order wo') && sql.includes('wo.plan_start <= ?')) {
        return [
          {
            id: '1',
            qty: 100,
            plan_start: '2026-10-09',
            plan_end: '2026-10-09',
            prod_line: 'Line-A',
          },
        ];
      }
      // 无报工
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09' },
      snapshotAt,
    );

    expect(res.metrics.completionRate).toBe(0);
    expect(res.metrics.goodRate).toBeNull();
    expect(res.metrics.calculationStatus).toBe('available');
  });

  it('空工单集合与无报工：完成率 null，良品率 null，calculationStatus=no_data', async () => {
    const mockDataSource = { query: vi.fn(async () => []) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09' },
      snapshotAt,
    );

    expect(res.metrics.completionRate).toBeNull();
    expect(res.metrics.goodRate).toBeNull();
    expect(res.metrics.calculationStatus).toBe('no_data');
  });

  it('所选范围存在计划起止日期缺失的工单：insufficient_data 与 missingInputs', async () => {
    const customQuery = async (sql: string) => {
      if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) {
        return [{ cnt: 2 }]; // 存在 2 张缺失计划的工单
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09' },
      snapshotAt,
    );

    expect(res.metrics.calculationStatus).toBe('insufficient_data');
    expect(res.metrics.missingInputs).toBeDefined();
    expect(res.metrics.missingInputs?.length).toBeGreaterThan(0);
  });

  it('设备指标：真实计数、OEE 为 null、missingInputs 及 insufficient_data', async () => {
    const customQuery = async (sql: string) => {
      if (sql.includes('FROM device')) {
        return [
          { status: '运行中', cnt: 8 },
          { status: '维修中', cnt: 1 },
          { status: '待机', cnt: 2 },
          { status: '停机', cnt: 0 },
        ];
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getDeviceMetrics({}, snapshotAt);

    expect(res.counts).toEqual({
      运行中: 8,
      待机: 2,
      维修中: 1,
      停机: 0,
    });
    expect(res.oee).toBeNull();
    expect(res.calculationStatus).toBe('insufficient_data');
    expect(res.missingInputs).toEqual(['计划生产时间', '设备产出归属', '理想节拍']);
  });

  it('交付指标：按 dueDate 筛选并依 Q1 派生规则计算完成/延期订单数', async () => {
    const customQuery = async (sql: string) => {
      if (sql.includes('FROM sale_order o')) {
        return [
          // 订单 1: 关联工单全部完工 -> 已完成
          {
            id: '1',
            base_status: '已确认',
            due_date: '2026-10-15',
            work_order_total: 1,
            work_order_open: 0,
            work_order_active: 0,
          },
          // 订单 2: 超期且未完工 (due_date < 2026-10-09) -> 已延期
          {
            id: '2',
            base_status: '已确认',
            due_date: '2026-10-05',
            work_order_total: 1,
            work_order_open: 1,
            work_order_active: 1,
          },
          // 订单 3: 未超期在产 -> 生产中 (不算已完成也不算延期)
          {
            id: '3',
            base_status: '已确认',
            due_date: '2026-10-20',
            work_order_total: 1,
            work_order_open: 1,
            work_order_active: 1,
          },
        ];
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const service = new MetricsAggregationService(mockDataSource);

    const res = await service.getDeliveryMetrics(
      { startDate: '2026-10-01', endDate: '2026-10-31' },
      snapshotAt,
    );

    expect(res.orderCount).toBe(3);
    expect(res.completedOrderCount).toBe(1);
    expect(res.delayedOrderCount).toBe(1);
    expect(res.calculationStatus).toBe('available');
  });

  describe('纯预警规则评估（evaluateAlertRules）', () => {
    it('goodRate 95% < 97% 触发，completionRate 76% < 90% 触发，维修中设备 1 台触发', async () => {
      const customQuery = async (sql: string) => {
        if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) return [{ cnt: 0 }];
        if (sql.includes('FROM work_order wo') && sql.includes('wo.plan_start <= ?')) {
          return [
            {
              id: '1',
              qty: 100,
              plan_start: '2026-10-09',
              plan_end: '2026-10-15',
              prod_line: 'SMT-3',
            },
          ];
        }
        if (sql.includes('FROM report r') && sql.includes('last_task.seq = wt.seq')) {
          return [{ good_qty: 76, bad_qty: 4, prod_line: 'SMT-3', work_order_id: '1' }];
        }
        if (sql.includes('SUM(r.good_qty)') && sql.includes('GROUP BY wo.id')) {
          return [{ work_order_id: '1', cumulative_good_qty: 76 }];
        }
        if (sql.includes('FROM device')) {
          return [{ status: '维修中', cnt: 1 }];
        }
        return [];
      };

      const mockDataSource = { query: vi.fn(customQuery) } as any;
      const service = new MetricsAggregationService(mockDataSource);

      const result = await service.evaluateAlertRules(
        { startDate: '2026-10-09', endDate: '2026-10-09' },
        snapshotAt,
      );

      expect(result.triggeredCount).toBe(3);
      const goodRateEval = result.evaluations.find((e) => e.ruleId === 'goodRate');
      expect(goodRateEval?.triggered).toBe(true);
      expect(goodRateEval?.actualValue).toBe(95);

      const compRateEval = result.evaluations.find((e) => e.ruleId === 'completionRate');
      expect(compRateEval?.triggered).toBe(true);
      expect(compRateEval?.actualValue).toBe(76);

      const devEval = result.evaluations.find((e) => e.ruleId === 'deviceMaintenance');
      expect(devEval?.triggered).toBe(true);
      expect(devEval?.actualValue).toBe(1);
    });

    it('恰好 97% 和 90% 不触发预警；null 不当 0 比较', async () => {
      const customQuery = async (sql: string) => {
        if (sql.includes('SELECT COUNT(DISTINCT wo.id) AS cnt')) return [{ cnt: 0 }];
        if (sql.includes('FROM work_order wo') && sql.includes('wo.plan_start <= ?')) {
          return [
            {
              id: '1',
              qty: 100,
              plan_start: '2026-10-09',
              plan_end: '2026-10-09',
              prod_line: 'SMT-1',
            },
          ];
        }
        if (sql.includes('FROM report r') && sql.includes('last_task.seq = wt.seq')) {
          // 97 / 100 = 97% 恰好 97%
          return [{ good_qty: 97, bad_qty: 3, prod_line: 'SMT-1', work_order_id: '1' }];
        }
        if (sql.includes('SUM(r.good_qty)') && sql.includes('GROUP BY wo.id')) {
          // 90 / 100 = 90% 恰好 90%
          return [{ work_order_id: '1', cumulative_good_qty: 90 }];
        }
        if (sql.includes('FROM device')) {
          return [{ status: '运行中', cnt: 10 }];
        }
        return [];
      };

      const mockDataSource = { query: vi.fn(customQuery) } as any;
      const service = new MetricsAggregationService(mockDataSource);

      const result = await service.evaluateAlertRules(
        { startDate: '2026-10-09', endDate: '2026-10-09' },
        snapshotAt,
      );

      expect(result.triggeredCount).toBe(0);
      const goodRateEval = result.evaluations.find((e) => e.ruleId === 'goodRate');
      expect(goodRateEval?.triggered).toBe(false);
      expect(goodRateEval?.actualValue).toBe(97);

      const compRateEval = result.evaluations.find((e) => e.ruleId === 'completionRate');
      expect(compRateEval?.triggered).toBe(false);
      expect(compRateEval?.actualValue).toBe(90);
    });
  });
});
