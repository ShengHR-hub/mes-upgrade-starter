/**
 * 展示层格式化（纯函数，便于单测）。
 *
 * 诚实性原则（S4 要求第 5、6 条）：
 * - `null` 表示「已知缺失 / 无法计算」，必须显示为「暂无数据」或「缺少计算条件」，
 *   **不得转换成 0**；
 * - BIGINT ID 保持字符串，禁止 `Number()` 转换（避免精度损失）；
 * - DECIMAL 保持契约字符串（如 `"2.00"`），不自行改写精度；
 * - 百分比按契约约定：`96` 就是 `96%`，**不乘 100、不除 100**。
 */

import type { DecimalString, Id } from '@/types/api'

/** 通用缺失文案 */
export const NULL_TEXT = '暂无数据'

/** 缺少计算条件（如 OEE 的 insufficient_data） */
export const MISSING_INPUT_TEXT = '缺少计算条件'

export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/** 文本展示：null / undefined → 缺失文案（不变成 "0"、不变成空串） */
export function formatNullableText(value: unknown, nullText: string = NULL_TEXT): string {
  if (isNullish(value)) return nullText
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return nullText
}

/**
 * ID 展示：**保持字符串原样**。
 * 类型层面已用 `Id = string` 约束；此处仅处理缺失值。
 */
export function formatId(value: Id | null | undefined, nullText: string = NULL_TEXT): string {
  if (isNullish(value)) return nullText
  return value
}

/** DECIMAL 展示：保持契约字符串原样（不做浮点转换） */
export function formatDecimal(value: DecimalString | null | undefined, nullText: string = NULL_TEXT): string {
  if (isNullish(value)) return nullText
  return value
}

/** 整数计数展示：null 保持为缺失文案，不显示 0 */
export function formatCount(value: number | null | undefined, nullText: string = NULL_TEXT): string {
  if (isNullish(value)) return nullText
  return String(value)
}

export interface PercentFormatOptions {
  nullText?: string
  /** 小数位；不传则原样输出（契约示例 95 → "95%"） */
  fractionDigits?: number
}

/** 百分比展示：不乘 100、不除 100 */
export function formatPercent(value: number | null | undefined, options: PercentFormatOptions = {}): string {
  const nullText = options.nullText ?? NULL_TEXT
  if (isNullish(value)) return nullText
  const text =
    typeof options.fractionDigits === 'number' ? value.toFixed(options.fractionDigits) : String(value)
  return `${text}%`
}

/**
 * 计算状态文案（契约 §6.8 / §6.7）：
 * - `available`：数值可用
 * - `no_data`：空集合 / 分母为 0
 * - `insufficient_data`：缺关键输入，须展示缺失项
 */
export function formatCalculationStatus(status: string | null | undefined): string {
  switch (status) {
    case 'available':
      return '可用'
    case 'no_data':
      return '无数据'
    case 'insufficient_data':
      return MISSING_INPUT_TEXT
    case undefined:
    case null:
      return NULL_TEXT
    default:
      return status
  }
}

/** 缺失项列表展示（如 OEE 的 missingInputs） */
export function formatMissingInputs(inputs: readonly string[] | null | undefined): string {
  if (isNullish(inputs) || inputs.length === 0) return '无'
  return inputs.join('、')
}
