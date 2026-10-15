/**
 * `YYYY-MM-DD`（契约 §2.1 的 date 类型）校验与比较工具。
 *
 * 为什么要单独做「真实日历日」校验：正则 `\d{4}-\d{2}-\d{2}` 会放过 `2026-02-31`、
 * `2026-13-01` 这类不存在的日期。任务书 §三 要求「日期须真实有效」。
 *
 * 与 DATETIME 严格区分：本工具只处理 DATE，不接收时间部分（契约 §2.1）。
 */

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** MySQL DATE 的取值范围（schema 使用 DATE 列） */
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

/** 是否为合法的 `YYYY-MM-DD` 且对应真实存在的日历日 */
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // 用 UTC 构造避免本机时区影响；回读三个字段是否与输入一致
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * 比较两个 DATE 字符串（`a < b` 返回负数，`a > b` 返回正数，相等返回 0）。
 *
 * 入参必须已通过 `isValidDateOnly`；定长 ISO 格式下字典序即时间序。
 */
export function compareDateOnly(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 把 `YYYY-MM-DD` 压成 `YYYYMMDD`（工单编号前缀用） */
export function compactDateOnly(value: string): string {
  return value.replace(/-/g, '');
}

/** 获取 `YYYY-MM-DD` 的次日 `YYYY-MM-DD`（半开区间查询用） */
export function nextDayDateOnly(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 计算两个合法 `YYYY-MM-DD` 之间的天数差（b - a） */
export function daysDifference(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (24 * 60 * 60 * 1000));
}

/** 在 `YYYY-MM-DD` 基础上增加指定天数 */
export function addDaysDateOnly(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

