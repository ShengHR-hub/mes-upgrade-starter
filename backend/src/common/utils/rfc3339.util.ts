import { ASIA_SHANGHAI_OFFSET_MINUTES, toRfc3339 } from './datetime.util.js';
import { isValidDateOnly } from './date-only.util.js';

/**
 * RFC 3339 时间（契约 §2.1）的严格解析与 MySQL DATETIME 互转。
 *
 * 契约要求：时间使用 RFC 3339，例如 `2026-10-09T08:30:00+08:00`，业务时区 Asia/Shanghai。
 *
 * 为什么需要本工具：
 * - `work_task.plan_start / plan_end / started_at / finished_at` 是 **DATETIME**，
 *   必须落库为 `YYYY-MM-DD HH:mm:ss` 的字面墙钟值；
 * - 直接把 `2026-10-09T08:30:00+08:00` 交给驱动会被 MySQL 拒绝或误解析；
 * - 需要严格拒绝 `2026-02-31T10:00:00+08:00` 这类不存在的日期。
 */

/** RFC 3339：`YYYY-MM-DDTHH:mm:ss` + 可选小数秒 + 必带偏移（Z 或 ±HH:MM） */
export const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 解析 RFC 3339 时间为 `Date`；不合法返回 null。
 *
 * 校验顺序：整体格式 → 日历日真实存在 → 时分秒范围 → `Date` 可解析。
 */
export function parseRfc3339(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const matched = RFC3339_PATTERN.exec(value);
  if (!matched) return null;

  const [, year, month, day, hour, minute, second] = matched;
  if (!isValidDateOnly(`${year}-${month}-${day}`)) return null;

  const hours = Number(hour);
  const minutes = Number(minute);
  const seconds = Number(second);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 把 `Date` 转成 MySQL DATETIME 字面量（Asia/Shanghai 墙钟） */
export function toMysqlDatetime(date: Date): string {
  return toRfc3339(date, ASIA_SHANGHAI_OFFSET_MINUTES).slice(0, 19).replace('T', ' ');
}

/** 把 MySQL DATETIME 字面量（`YYYY-MM-DD HH:mm:ss`）转成业务时区 RFC 3339 */
export function mysqlDatetimeToRfc3339(literal: string | null): string | null {
  if (literal === null || literal.length === 0) return null;
  return `${literal.slice(0, 19).replace(' ', 'T')}+08:00`;
}
