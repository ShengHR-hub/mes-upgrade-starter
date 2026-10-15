/**
 * B11 Pareto 纯计算（契约 §6.5）。
 *
 * 口径（任务书 §B11 要求）：
 * 1. 使用 `defect.qty` 聚合（SQL 侧 SUM），不在 JS 侧做浮点累加；
 * 2. 排序：`qty` 降序、`defectType` 升序（显式全序比较，稳定可重现）；
 * 3. 返回 `share`（占比）与 `cumulativeShare`（累计占比），百分比口径（96 = 96%）；
 * 4. **总量为 0 时不得制造百分比** —— 无不良记录返回空数组，不产出 0% 条目。
 *
 * 该文件只做纯函数计算，便于单元测试；SQL 归属 service。
 */

export interface ParetoRawItem {
  defectType: string;
  qty: number;
}

export interface ParetoComputedItem {
  defectType: string;
  qty: number;
  share: number;
  cumulativeShare: number;
}

/** 百分比四舍五入到 2 位（与 B8 驾驶舱 `Number((x*100).toFixed(2))` 同一口径） */
export function roundPercent(ratio: number): number {
  return Number((ratio * 100).toFixed(2));
}

/**
 * 由聚合行计算 Pareto 条目。
 *
 * @param rawRows SQL 聚合结果（defect_type + SUM(qty)）
 * @param totalDefectQty 全部不良数量合计；为 0 / 空集合时返回 `[]`（诚实空结果）
 */
export function buildParetoItems(
  rawRows: readonly ParetoRawItem[],
  totalDefectQty: number,
): ParetoComputedItem[] {
  if (totalDefectQty <= 0 || rawRows.length === 0) return [];

  // 显式全序：qty 降序 → defectType 升序（字典序）。不依赖引擎 sort 稳定性。
  const sorted = [...rawRows].sort((a, b) => {
    if (b.qty !== a.qty) return b.qty - a.qty;
    if (a.defectType === b.defectType) return 0;
    return a.defectType < b.defectType ? -1 : 1;
  });

  let cumulative = 0;
  return sorted.map((row) => {
    cumulative += row.qty;
    return {
      defectType: row.defectType,
      qty: row.qty,
      share: roundPercent(row.qty / totalDefectQty),
      cumulativeShare: roundPercent(cumulative / totalDefectQty),
    };
  });
}

/**
 * 报工不良率 / 良品率（同一口径，分子分母均为**报工数量**）。
 *
 * 铁律（契约 §6.5 / §6.8）：趋势与良品率只用 `report.good_qty / bad_qty`，
 * **不把质检 ng_qty 重复加进报工数量**；分母为 0 时返回 null（不以 0 冒充未知）。
 */
export function reportRate(goodQty: number, badQty: number): number | null {
  const total = goodQty + badQty;
  if (total <= 0) return null;
  return roundPercent(goodQty / total);
}

/** 报工不良率 = badQty / (goodQty + badQty) */
export function reportBadRate(goodQty: number, badQty: number): number | null {
  const total = goodQty + badQty;
  if (total <= 0) return null;
  return roundPercent(badQty / total);
}
