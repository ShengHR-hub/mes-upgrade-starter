import { describe, expect, it } from 'vitest'

import {
  formatCalculationStatus,
  formatCount,
  formatDecimal,
  formatId,
  formatMissingInputs,
  formatNullableText,
  formatPercent,
  MISSING_INPUT_TEXT,
  NULL_TEXT,
} from './format'

describe('格式化 · null 不得变成 0', () => {
  it('文本缺失显示「暂无数据」', () => {
    expect(formatNullableText(null)).toBe(NULL_TEXT)
    expect(formatNullableText(undefined)).toBe(NULL_TEXT)
    expect(formatNullableText('')).toBe('')
  })

  it('计数缺失显示缺失文案而不是 0', () => {
    expect(formatCount(null)).toBe(NULL_TEXT)
    expect(formatCount(undefined)).toBe(NULL_TEXT)
    expect(formatCount(null)).not.toBe('0')
    expect(formatCount(0)).toBe('0')
  })

  it('百分比缺失显示缺失文案而不是 0%', () => {
    expect(formatPercent(null)).toBe(NULL_TEXT)
    expect(formatPercent(undefined)).toBe(NULL_TEXT)
    expect(formatPercent(0)).toBe('0%')
  })
})

describe('格式化 · BIGINT ID 保持字符串', () => {
  it('超安全整数范围的 ID 原样保留', () => {
    // 若被 Number() 转换会变成 9007199254740992
    expect(formatId('9007199254740993')).toBe('9007199254740993')
    expect(formatId('101')).toBe('101')
  })

  it('ID 缺失显示缺失文案', () => {
    expect(formatId(null)).toBe(NULL_TEXT)
    expect(formatId(undefined)).toBe(NULL_TEXT)
  })
})

describe('格式化 · DECIMAL 保持契约字符串', () => {
  it('保留两位小数写法，不做浮点转换', () => {
    expect(formatDecimal('2.00')).toBe('2.00')
    expect(formatDecimal('0.50')).toBe('0.50')
    expect(formatDecimal('200.00')).toBe('200.00')
  })

  it('缺失显示缺失文案', () => {
    expect(formatDecimal(null)).toBe(NULL_TEXT)
  })
})

describe('格式化 · 百分比不乘除 100', () => {
  it('契约约定 96 表示 96%', () => {
    expect(formatPercent(96)).toBe('96%')
    expect(formatPercent(95.5)).toBe('95.5%')
    expect(formatPercent(95.5, { fractionDigits: 2 })).toBe('95.50%')
    expect(formatPercent(76)).not.toBe('7600%')
  })
})

describe('格式化 · 计算状态与缺失项', () => {
  it('三种计算状态文案', () => {
    expect(formatCalculationStatus('available')).toBe('可用')
    expect(formatCalculationStatus('no_data')).toBe('无数据')
    expect(formatCalculationStatus('insufficient_data')).toBe(MISSING_INPUT_TEXT)
    expect(formatCalculationStatus(null)).toBe(NULL_TEXT)
    expect(formatCalculationStatus('自定义状态')).toBe('自定义状态')
  })

  it('缺失项列表', () => {
    expect(formatMissingInputs(['计划生产时间', '理想节拍'])).toBe('计划生产时间、理想节拍')
    expect(formatMissingInputs([])).toBe('无')
    expect(formatMissingInputs(null)).toBe('无')
  })
})
