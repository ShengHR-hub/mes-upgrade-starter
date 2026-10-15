import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { QualityAnalysesService } from './quality-analyses.service.js';

/**
 * B11 SPC 服务单测（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九后端测试要求：
 * - Pareto 排序、累计占比与空数据；
 * - 趋势按**报工数量**计算（不混入质检 ng_qty）；
 * - 良品率恒 `isTrueFpy:false`，无数据时 value=null；
 * - 产线过滤与「未分配」记录（无任务检验不纳入指定产线）；
 * - 严格半开区间与日期校验。
 */

interface Executed {
  sql: string;
  params: unknown[];
}

function makeHarness(options: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): { service: QualityAnalysesService; executed: Executed[] } {
  const executed: Executed[] = [];
  const run = async (sql: string, params?: unknown[]): Promise<unknown> => {
    executed.push({ sql, params: params ?? [] });
    return options.query(sql, params);
  };
  const dataSource = {
    // 与真实 TypeORM 一致：transaction(isolationLevel, run) 或 transaction(run)
    transaction: (...args: unknown[]) => {
      const maybeRun = args[args.length - 1] as (executor: unknown) => Promise<unknown>;
      return maybeRun({ query: run });
    },
    query: run,
  };
  return { service: new QualityAnalysesService(dataSource as never), executed };
}

const SNAPSHOT = '2026-10-14T21:00:00+08:00';
const BASE_QUERY = { startDate: '2026-10-09', endDate: '2026-10-09' };

describe('QualityAnalysesService.pareto', () => {
  it('半开区间 + defect.qty 聚合，按 qty 降序 / defectType 升序', async () => {
    const { service, executed } = makeHarness({
      query: async () => [
        { defect_type: '虚焊', qty: '4' },
        { defect_type: '错件', qty: '10' },
        { defect_type: '少件', qty: '2' },
      ],
    });

    const result = await service.pareto(BASE_QUERY, SNAPSHOT);

    // 严格半开区间：>= 开始日 00:00 且 < 结束日次日 00:00
    expect(executed[0].params[0]).toBe('2026-10-09 00:00:00');
    expect(executed[0].params[1]).toBe('2026-10-10 00:00:00');
    expect(executed[0].sql).toContain('FROM defect');
    expect(executed[0].sql).toContain('SUM(d.qty)');

    expect(result.totalDefectQty).toBe(16);
    expect(result.calculationStatus).toBe('available');
    expect(result.items.map((item) => item.defectType)).toEqual(['错件', '虚焊', '少件']);
    expect(result.items.map((item) => item.share)).toEqual([62.5, 25, 12.5]);
    expect(result.items.map((item) => item.cumulativeShare)).toEqual([62.5, 87.5, 100]);
    expect(result.dataSource).toBe('demo');
    expect(result.dataLabel).toBe('演示数据');
  });

  it('空数据（无缺陷）→ items 为空、calculationStatus=no_data，不制造 0%', async () => {
    const { service } = makeHarness({ query: async () => [] });
    const result = await service.pareto(BASE_QUERY, SNAPSHOT);
    expect(result.items).toEqual([]);
    expect(result.totalDefectQty).toBe(0);
    expect(result.calculationStatus).toBe('no_data');
  });

  it('指定产线时：SQL 只纳入可确认归属的检验（LEFT JOIN + prod_line 条件）', async () => {
    const { service, executed } = makeHarness({ query: async () => [] });
    await service.pareto({ ...BASE_QUERY, prodLine: 'SMT-2线' }, SNAPSHOT);

    expect(executed[0].sql).toContain('LEFT JOIN work_task t ON q.task_id = t.id');
    expect(executed[0].sql).toContain('t.prod_line = ?');
    expect(executed[0].params).toContain('SMT-2线');
    // 无任务检验（task_id 为空）不匹配 prod_line 条件，被排除
  });

  it('prodLine=未分配时纳入无产线归属记录', async () => {
    const { service, executed } = makeHarness({ query: async () => [] });
    await service.pareto({ ...BASE_QUERY, prodLine: '未分配' }, SNAPSHOT);
    expect(executed[0].sql).toContain('t.prod_line IS NULL');
  });

  it('非法日期 / startDate > endDate → 10001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(
      service.pareto({ startDate: '2026-02-31', endDate: '2026-10-09' }, SNAPSHOT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    await expect(
      service.pareto({ startDate: '2026-10-10', endDate: '2026-10-09' }, SNAPSHOT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });
});

describe('QualityAnalysesService.trends', () => {
  it('按报工数量计算 reportBadRate，不查询质检 ng_qty', async () => {
    const { service, executed } = makeHarness({
      query: async () => [
        { report_date: '2026-10-08', good_qty: '50', bad_qty: '0' },
        { report_date: '2026-10-09', good_qty: '76', bad_qty: '4' },
      ],
    });

    const result = await service.trends(BASE_QUERY, SNAPSHOT);

    expect(executed[0].sql).toContain('FROM report r');
    expect(executed[0].sql).toContain('JOIN work_task t ON r.task_id = t.id');
    expect(executed[0].sql).not.toContain('ng_qty');
    expect(result.metric).toBe('reportBadRate');
    expect(result.points).toEqual([
      { date: '2026-10-08', goodQty: 50, badQty: 0, badRate: 0 },
      { date: '2026-10-09', goodQty: 76, badQty: 4, badRate: 5 },
    ]);
  });

  it('无报工数据 → points 为空、no_data（不以 0 冒充未知）', async () => {
    const { service } = makeHarness({ query: async () => [] });
    const result = await service.trends(BASE_QUERY, SNAPSHOT);
    expect(result.points).toEqual([]);
    expect(result.calculationStatus).toBe('no_data');
  });

  it('stepName 过滤下推到 SQL', async () => {
    const { service, executed } = makeHarness({ query: async () => [] });
    await service.trends({ ...BASE_QUERY, stepName: '回流焊' }, SNAPSHOT);
    expect(executed[0].sql).toContain('t.step_name = ?');
    expect(executed[0].params).toContain('回流焊');
  });
});

describe('QualityAnalysesService.goodRates', () => {
  it('报工良品率：76/80 = 95，isTrueFpy 恒为 false', async () => {
    const { service, executed } = makeHarness({
      query: async () => [{ good_qty: '76', bad_qty: '4', report_count: '3' }],
    });

    const result = await service.goodRates(BASE_QUERY, SNAPSHOT);

    expect(executed[0].sql).toContain('SUM(r.good_qty)');
    expect(executed[0].sql).not.toContain('ng_qty');
    expect(result.metric).toBe('reportGoodRate');
    expect(result.value).toBe(95);
    expect(result.isTrueFpy).toBe(false);
    expect(result.calculationStatus).toBe('available');
  });

  it('无报工数据 → value=null + no_data，不用 0 冒充', async () => {
    const { service } = makeHarness({
      query: async () => [{ good_qty: '0', bad_qty: '0', report_count: '0' }],
    });
    const result = await service.goodRates(BASE_QUERY, SNAPSHOT);
    expect(result.value).toBeNull();
    expect(result.calculationStatus).toBe('no_data');
  });
});
