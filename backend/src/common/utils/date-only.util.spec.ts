import { describe, expect, it } from 'vitest';

import {
  addDaysDateOnly,
  compareDateOnly,
  compactDateOnly,
  daysDifference,
  isValidDateOnly,
} from './date-only.util.js';

describe('isValidDateOnly —— 必须是真实存在的日历日', () => {
  it('接受合法日期', () => {
    expect(isValidDateOnly('2026-10-10')).toBe(true);
    expect(isValidDateOnly('2026-02-28')).toBe(true);
    expect(isValidDateOnly('2024-02-29')).toBe(true); // 闰年
    expect(isValidDateOnly('2026-12-31')).toBe(true);
  });

  it('拒绝不存在的日历日（正则放行但语义非法）', () => {
    expect(isValidDateOnly('2026-02-31')).toBe(false);
    expect(isValidDateOnly('2026-02-29')).toBe(false); // 2026 非闰年
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2026-00-10')).toBe(false);
    expect(isValidDateOnly('2026-10-00')).toBe(false);
    expect(isValidDateOnly('2026-04-31')).toBe(false);
  });

  it('拒绝格式错误与带时间部分的输入（严格区分 date 与 datetime）', () => {
    expect(isValidDateOnly('2026-1-1')).toBe(false);
    expect(isValidDateOnly('2026/10/10')).toBe(false);
    expect(isValidDateOnly('2026-10-10T00:00:00+08:00')).toBe(false);
    expect(isValidDateOnly('2026-10-10 00:00:00')).toBe(false);
    expect(isValidDateOnly(20261010)).toBe(false);
    expect(isValidDateOnly(null)).toBe(false);
    expect(isValidDateOnly(undefined)).toBe(false);
  });

  it('拒绝超出 MySQL DATE 范围的年份', () => {
    expect(isValidDateOnly('0999-01-01')).toBe(false);
  });
});

describe('compareDateOnly / compactDateOnly', () => {
  it('字典序即时间序', () => {
    expect(compareDateOnly('2026-10-09', '2026-10-10')).toBeLessThan(0);
    expect(compareDateOnly('2026-10-10', '2026-10-10')).toBe(0);
    expect(compareDateOnly('2026-11-01', '2026-10-31')).toBeGreaterThan(0);
  });

  it('压缩为 YYYYMMDD', () => {
    expect(compactDateOnly('2026-10-09')).toBe('20261009');
  });

  it('daysDifference 与 addDaysDateOnly 准确处理自然日跨越', () => {
    expect(daysDifference('2026-10-09', '2026-10-15')).toBe(6);
    expect(daysDifference('2026-10-15', '2026-10-09')).toBe(-6);
    expect(daysDifference('2026-10-09', '2026-10-09')).toBe(0);
    expect(daysDifference('2026-10-31', '2026-11-01')).toBe(1);
    expect(addDaysDateOnly('2026-10-09', 6)).toBe('2026-10-15');
    expect(addDaysDateOnly('2026-10-31', 1)).toBe('2026-11-01');
  });
});
