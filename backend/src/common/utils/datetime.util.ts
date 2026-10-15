/**
 * 时间格式化工具 —— 契约 §2.1：
 * 「时间 RFC 3339，例如 `2026-10-09T08:30:00+08:00`。业务时区 Asia/Shanghai。」
 *
 * 说明：Node 默认 `toISOString()` 输出 UTC（`...Z`），与契约示例的 `+08:00` 形式不一致。
 * 这里显式按固定偏移格式化，保证输出稳定、不依赖运行机器的本地时区设置。
 */

/** Asia/Shanghai 相对 UTC 的偏移（分钟）。 */
export const ASIA_SHANGHAI_OFFSET_MINUTES = 480;

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, '0');
}

/**
 * 把 Date 格式化为带指定时区偏移的 RFC 3339 字符串。
 *
 * @param date 目标时间，默认当前时刻
 * @param offsetMinutes 时区偏移（分钟），默认 +480（Asia/Shanghai）
 */
export function toRfc3339(
  date: Date = new Date(),
  offsetMinutes: number = ASIA_SHANGHAI_OFFSET_MINUTES,
): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const iso = shifted.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const minutes = pad(Math.abs(offsetMinutes) % 60);
  return `${iso.slice(0, -1)}${sign}${hours}:${minutes}`;
}

/** 业务时区（Asia/Shanghai）的 RFC 3339 时间戳。 */
export function toShanghaiRfc3339(date: Date = new Date()): string {
  return toRfc3339(date, ASIA_SHANGHAI_OFFSET_MINUTES);
}

/** 业务时区（Asia/Shanghai）的日期，格式 `YYYY-MM-DD`。 */
export function toShanghaiDate(date: Date = new Date()): string {
  return toShanghaiRfc3339(date).slice(0, 10);
}

/** 业务时区（Asia/Shanghai）的 SQL DATETIME 字符串，格式 `YYYY-MM-DD HH:mm:ss`。 */
export function toShanghaiSqlDateTime(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + ASIA_SHANGHAI_OFFSET_MINUTES * 60_000);
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}
