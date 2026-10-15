import { describe, expect, it } from 'vitest';

import { buildParetoChartData, buildTrendChartData } from './spc-charts';

/**
 * B11 SPC 图表几何单测（纯函数）。
 *
 * 覆盖任务书 §九前端测试要求：Pareto / 趋势 / 良品率渲染的数据准备逻辑，
 * 特别是 null 断线（不以 0 冒充未知）与空数据诚实处理。
 */
describe('buildParetoChartData', () => {
  it('空数据返回空几何（不生成占位假数据）', () => {
    expect(buildParetoChartData([])).toEqual({ bars: [], maxShare: 0 });
  });

  it('按 share 归一宽度，并生成累计占比折线坐标', () => {
    const chart = buildParetoChartData([
      { defectType: '虚焊', qty: 40, share: 80, cumulativeShare: 80 },
      { defectType: '错件', qty: 10, share: 20, cumulativeShare: 100 },
    ]);
    expect(chart.maxShare).toBe(80);
    expect(chart.bars[0].widthPercent).toBe(100);
    expect(chart.bars[1].widthPercent).toBe(25);
    // 累计 80% → y = 100 - 80 = 20；100% → y = 0
    expect(chart.bars[0].lineY).toBe(20);
    expect(chart.bars[1].lineY).toBe(0);
  });

  it('累计占比越界值时裁剪到 0~100', () => {
    const chart = buildParetoChartData([
      { defectType: 'a', qty: 1, share: 100, cumulativeShare: 120 },
    ]);
    expect(chart.bars[0].lineY).toBe(0);
  });
});

describe('buildTrendChartData', () => {
  it('空数据返回空几何', () => {
    expect(buildTrendChartData([])).toEqual({ points: [], segments: [], yMax: 10, dateLabels: [] });
  });

  it('按日期升序绘制，badRate 折线按 yMax 归一', () => {
    const chart = buildTrendChartData([
      { date: '2026-10-09', goodQty: 76, badQty: 4, badRate: 5 },
      { date: '2026-10-08', goodQty: 50, badQty: 0, badRate: 0 },
    ]);
    expect(chart.dateLabels).toEqual(['2026-10-08', '2026-10-09']);
    expect(chart.yMax).toBe(10);
    expect(chart.segments.length).toBe(1);
    // 两个点：0% → (0,100)；5% → (100,50)
    expect(chart.segments[0]).toBe('0,100 100,50');
  });

  it('badRate 为 null 的日期断开折线（不以 0 代替未知）', () => {
    const chart = buildTrendChartData([
      { date: '2026-10-07', goodQty: 10, badQty: 1, badRate: 9.09 },
      { date: '2026-10-08', goodQty: 0, badQty: 0, badRate: null },
      { date: '2026-10-09', goodQty: 76, badQty: 4, badRate: 5 },
    ]);
    expect(chart.segments.length).toBe(2);
    expect(chart.points[1].badRate).toBeNull();
  });

  it('y 轴上限至少 10 且向上取整到 10 的倍数', () => {
    const chart = buildTrendChartData([
      { date: '2026-10-09', goodQty: 10, badQty: 13, badRate: 56.52 },
    ]);
    expect(chart.yMax).toBe(60);
  });
});
