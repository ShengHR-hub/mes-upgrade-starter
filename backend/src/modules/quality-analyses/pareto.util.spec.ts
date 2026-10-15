import { describe, expect, it } from 'vitest';

import { buildParetoItems, reportBadRate, reportRate, roundPercent } from './pareto.util.js';

/**
 * B11 Pareto 纯计算单测（契约 §6.5 / 任务书 §B11 要求 1-3、12）。
 */
describe('buildParetoItems', () => {
  it('按 qty 降序、defectType 升序稳定排序，并计算 share / cumulativeShare', () => {
    const items = buildParetoItems(
      [
        { defectType: '虚焊', qty: 4 },
        { defectType: '错件', qty: 10 },
        { defectType: '划伤', qty: 4 },
        { defectType: '少件', qty: 2 },
      ],
      20,
    );

    expect(items.map((item) => item.defectType)).toEqual(['错件', '划伤', '虚焊', '少件']);
    expect(items.map((item) => item.qty)).toEqual([10, 4, 4, 2]);
    expect(items.map((item) => item.share)).toEqual([50, 20, 20, 10]);
    expect(items.map((item) => item.cumulativeShare)).toEqual([50, 70, 90, 100]);
  });

  it('总量为 0（无缺陷）时返回空数组，不制造百分比', () => {
    expect(buildParetoItems([], 0)).toEqual([]);
    expect(buildParetoItems([{ defectType: '虚焊', qty: 0 }], 0)).toEqual([]);
  });

  it('最后一项累计占比为 100', () => {
    const items = buildParetoItems(
      [
        { defectType: 'a', qty: 1 },
        { defectType: 'b', qty: 2 },
        { defectType: 'c', qty: 3 },
      ],
      6,
    );
    expect(items.at(-1)?.cumulativeShare).toBe(100);
  });
});

describe('报工比率口径（只使用报工数量，不混入质检 ng_qty）', () => {
  it('reportRate / reportBadRate：分母为 0 时返回 null（不以 0 冒充未知）', () => {
    expect(reportRate(0, 0)).toBeNull();
    expect(reportBadRate(0, 0)).toBeNull();
  });

  it('良品率与不良率互补（76 良 4 不良 → 95 / 5）', () => {
    expect(reportRate(76, 4)).toBe(95);
    expect(reportBadRate(76, 4)).toBe(5);
  });

  it('百分比口径：96 表示 96%', () => {
    expect(roundPercent(0.96)).toBe(96);
    expect(reportRate(96, 4)).toBe(96);
  });
});
