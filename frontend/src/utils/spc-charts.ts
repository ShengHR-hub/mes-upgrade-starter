/**
 * B11 SPC 图表数据变换（纯函数，无第三方图表依赖，输出 SVG 坐标）。
 *
 * 诚实性原则：
 * - Pareto 条形按 `share` 归一；累计占比单独画折线（右轴语义 0~100%）；
 * - 趋势折线只连接有值的点：`badRate` 为 null 的日期**断线**（不以 0 冒充未知）；
 * - 日期始终按升序绘制；空数据返回空几何，不生成占位假数据。
 */

import type { ParetoItem, TrendPoint } from '@/types/quality-analysis'

export interface ParetoBarGeometry {
  defectType: string
  qty: number
  share: number
  cumulativeShare: number
  /** 条形宽度百分比（0~100，按 share / maxShare 归一） */
  widthPercent: number
  /** 累计折线 x / y（百分比坐标，0~100） */
  lineX: number
  lineY: number
}

export interface ParetoChartData {
  bars: ParetoBarGeometry[]
  maxShare: number
}

/** Pareto 图几何（含累计占比折线坐标；y 轴倒置：占比越大越靠上） */
export function buildParetoChartData(items: readonly ParetoItem[]): ParetoChartData {
  if (items.length === 0) return { bars: [], maxShare: 0 }
  const maxShare = Math.max(...items.map((item) => item.share), 0);
  const bars = items.map((item, index) => ({
    defectType: item.defectType,
    qty: item.qty,
    share: item.share,
    cumulativeShare: item.cumulativeShare,
    widthPercent: maxShare > 0 ? (item.share / maxShare) * 100 : 0,
    // x 按序号均分（每项占一个等宽刻度）；y 由累计占比换算（100% 在顶部）
    lineX: ((index + 0.5) / items.length) * 100,
    lineY: 100 - Math.min(Math.max(item.cumulativeShare, 0), 100),
  }));
  return { bars, maxShare };
}

export interface TrendChartData {
  points: Array<{ date: string; badRate: number | null; goodQty: number; badQty: number }>
  /** 折线分段：null 值断开，不连线、不以 0 代替 */
  segments: string[]
  /** y 轴上限（至少 10%，向上取整到 10 的倍数） */
  yMax: number
  dateLabels: string[]
}

/** 趋势图几何：badRate 折线（null 断线）+ 日期刻度 */
export function buildTrendChartData(points: readonly TrendPoint[]): TrendChartData {
  const sorted = [...points].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  if (sorted.length === 0) {
    return { points: [], segments: [], yMax: 10, dateLabels: [] };
  }
  const known = sorted
    .map((point) => point.badRate)
    .filter((rate): rate is number => rate !== null);
  const maxRate = known.length > 0 ? Math.max(...known) : 0;
  const yMax = Math.max(10, Math.ceil(maxRate / 10) * 10);

  const stepX = sorted.length > 1 ? 100 / (sorted.length - 1) : 50;
  const segments: string[] = [];
  let current: string[] = [];
  sorted.forEach((point, index) => {
    if (point.badRate === null) {
      if (current.length > 0) {
        segments.push(current.join(' '));
        current = [];
      }
      return;
    }
    const x = Number((index * stepX).toFixed(2));
    const y = Number((100 - (point.badRate / yMax) * 100).toFixed(2));
    current.push(`${x},${y}`);
  });
  if (current.length > 0) segments.push(current.join(' '));

  return {
    points: sorted.map((point) => ({ ...point })),
    segments,
    yMax,
    dateLabels: sorted.map((point) => point.date),
  };
}
