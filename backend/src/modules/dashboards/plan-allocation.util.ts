import {
  addDaysDateOnly,
  compareDateOnly,
  daysDifference,
  isValidDateOnly,
} from '../../common/utils/date-only.util.js';

export interface DailyPlanItem {
  date: string;
  planQty: number;
}

/**
 * 工单每日计划分配序列 —— 契约 §6.8 / Q5 已确认口径。
 *
 * 规则：
 * - 工单计划区间 planStart～planEnd，含首尾自然日，天数 N = days + 1；
 * - 前 N-1 天计划数为 floor(qty/N)；
 * - 最后一天补差：qty - floor(qty/N) × (N-1)；
 * - 单日计划为全部 qty；qty 小于天数时前几天为 0，最后一天全部补差；
 * - 每日计划之和严格等于工单 qty。
 */
export function allocateDailyPlanSeries(
  qty: number,
  planStart: string,
  planEnd: string,
): DailyPlanItem[] {
  if (!isValidDateOnly(planStart) || !isValidDateOnly(planEnd)) {
    throw new Error('计划起止日期必须为合法 YYYY-MM-DD');
  }
  if (compareDateOnly(planStart, planEnd) > 0) {
    throw new Error('计划开始日期不得晚于计划结束日期');
  }
  if (!Number.isInteger(qty) || qty < 0) {
    throw new Error('计划数量必须为非负整数');
  }

  const n = daysDifference(planStart, planEnd) + 1;
  const base = Math.floor(qty / n);
  const last = qty - base * (n - 1);

  const series: DailyPlanItem[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDaysDateOnly(planStart, i);
    const planQty = i === n - 1 ? last : base;
    series.push({ date, planQty });
  }

  return series;
}

/**
 * 计算单张工单在指定查询窗口 [windowStart, windowEnd] 内分摊的计划数量之和。
 *
 * 若工单计划区间与查询窗口无交集，返回 0。
 */
export function calculatePlanQtyInWindow(
  qty: number,
  planStart: string,
  planEnd: string,
  windowStart: string,
  windowEnd: string,
): number {
  if (!isValidDateOnly(planStart) || !isValidDateOnly(planEnd)) {
    throw new Error('计划起止日期必须为合法 YYYY-MM-DD');
  }
  if (!isValidDateOnly(windowStart) || !isValidDateOnly(windowEnd)) {
    throw new Error('窗口起止日期必须为合法 YYYY-MM-DD');
  }
  if (compareDateOnly(planStart, planEnd) > 0) {
    throw new Error('计划开始日期不得晚于计划结束日期');
  }
  if (compareDateOnly(windowStart, windowEnd) > 0) {
    throw new Error('窗口开始日期不得晚于窗口结束日期');
  }

  const overlapStart = compareDateOnly(planStart, windowStart) >= 0 ? planStart : windowStart;
  const overlapEnd = compareDateOnly(planEnd, windowEnd) <= 0 ? planEnd : windowEnd;

  if (compareDateOnly(overlapStart, overlapEnd) > 0) {
    return 0;
  }

  const n = daysDifference(planStart, planEnd) + 1;
  const base = Math.floor(qty / n);
  const last = qty - base * (n - 1);

  const overlapDays = daysDifference(overlapStart, overlapEnd) + 1;
  let totalPlanInWindow = 0;

  for (let d = 0; d < overlapDays; d++) {
    const curDate = addDaysDateOnly(overlapStart, d);
    const offsetFromStart = daysDifference(planStart, curDate);
    const dailyQty = offsetFromStart === n - 1 ? last : base;
    totalPlanInWindow += dailyQty;
  }

  return totalPlanInWindow;
}
