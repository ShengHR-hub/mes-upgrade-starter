/**
 * 工单编号方案（契约 §6.2 / 任务书 §二.8）—— 纯函数部分。
 *
 * 编号格式：`WO-YYYYMMDD-三位序号`，例如 `WO-20261009-001`。
 * - 日期取**确认日**的 Asia/Shanghai 日期；
 * - 日序号为三位数字，按天独立递增；
 * - **日序号耗尽（> 999）返回 30002，不扩充位数、不绕回覆盖**。
 *
 * 并发安全策略见 `orders.service.ts`：唯一约束冲突重试（不用无保护的 MAX+1）。
 */

export const WORK_ORDER_CODE_PREFIX = 'WO-';

/** 日序号位数（三位，契约固定） */
export const WORK_ORDER_SEQ_DIGITS = 3;

/** 日序号上限（999）；超过即视为当日耗尽 */
export const WORK_ORDER_MAX_SEQ = 999;

/** 单次分配的最大重试次数（并发冲突时递增重试的边界） */
export const WORK_ORDER_CODE_MAX_ATTEMPTS = 32;

/** 由 `YYYY-MM-DD` 生成编号前缀 `WO-YYYYMMDD-` */
export function workOrderCodePrefix(dateOnly: string): string {
  return `${WORK_ORDER_CODE_PREFIX}${dateOnly.replace(/-/g, '')}-`;
}

/** 由前缀 + 序号生成完整编号 */
export function formatWorkOrderCode(dateOnly: string, seq: number): string {
  return `${workOrderCodePrefix(dateOnly)}${String(seq).padStart(WORK_ORDER_SEQ_DIGITS, '0')}`;
}

/** 严格匹配某一天的编号（用于统计当日已用序号，避免匹配到更长/畸形编号） */
export function workOrderCodeRegexSource(dateOnly: string): string {
  return `^${workOrderCodePrefix(dateOnly).replace(/-/g, '\\-')}[0-9]{${WORK_ORDER_SEQ_DIGITS}}$`;
}

/** 从完整编号解析日序号；不合法返回 null */
export function parseWorkOrderSeq(code: string, dateOnly: string): number | null {
  const prefix = workOrderCodePrefix(dateOnly);
  if (!code.startsWith(prefix)) return null;
  const suffix = code.slice(prefix.length);
  if (!new RegExp(`^[0-9]{${WORK_ORDER_SEQ_DIGITS}}$`).test(suffix)) return null;
  return Number(suffix);
}
