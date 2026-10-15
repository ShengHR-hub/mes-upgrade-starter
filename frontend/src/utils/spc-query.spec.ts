import { describe, expect, it } from 'vitest';

import { buildSpcQueries } from './spc-query';

/**
 * B11 SPC 查询参数构造单测（S11 复审 P2 #4）。
 *
 * 独立 HTTP 探针实证：填写工序筛选后，trends 返回 200，而 paretos / good-rates
 * 因携带未知字段 stepName 被服务端 400/10001 拒绝。本测试锁死「按接口分别构造」。
 */
const FILTERS = {
  startDate: '2026-10-09',
  endDate: '2026-10-09',
  prodLine: '全部',
  stepName: '',
};

describe('buildSpcQueries', () => {
  it('未填工序筛选：三个接口参数一致，均不含 stepName 键', () => {
    const queries = buildSpcQueries(FILTERS);
    for (const query of [queries.pareto, queries.trend, queries.goodRate]) {
      expect(query.startDate).toBe('2026-10-09');
      expect(query.endDate).toBe('2026-10-09');
      // 「全部」→ 不按产线过滤
      expect(query.prodLine).toBeUndefined();
      expect('stepName' in query).toBe(false);
    }
  });

  it('填写工序筛选：只有 trends 携带 stepName（复审 P2 #4 回归）', () => {
    const queries = buildSpcQueries({ ...FILTERS, stepName: ' 回流焊 ' });
    expect(queries.trend.stepName).toBe('回流焊');
    expect('stepName' in queries.pareto).toBe(false);
    expect('stepName' in queries.goodRate).toBe(false);
  });

  it('指定产线时三个接口都携带 prodLine', () => {
    const queries = buildSpcQueries({ ...FILTERS, prodLine: 'SMT-2线' });
    expect(queries.pareto.prodLine).toBe('SMT-2线');
    expect(queries.trend.prodLine).toBe('SMT-2线');
    expect(queries.goodRate.prodLine).toBe('SMT-2线');
  });
});
