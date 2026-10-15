import { describe, expect, it } from 'vitest';

import {
  formatWorkOrderCode,
  parseWorkOrderSeq,
  WORK_ORDER_MAX_SEQ,
  workOrderCodePrefix,
  workOrderCodeRegexSource,
} from './work-order-code.js';

describe('工单编号格式 WO-YYYYMMDD-三位序号（契约 §6.2）', () => {
  it('前缀使用确认日（去连字符）', () => {
    expect(workOrderCodePrefix('2026-10-09')).toBe('WO-20261009-');
  });

  it('序号补足三位', () => {
    expect(formatWorkOrderCode('2026-10-09', 1)).toBe('WO-20261009-001');
    expect(formatWorkOrderCode('2026-10-09', 42)).toBe('WO-20261009-042');
    expect(formatWorkOrderCode('2026-10-09', WORK_ORDER_MAX_SEQ)).toBe('WO-20261009-999');
  });

  it('正则严格匹配当日三位序号（不匹配四位或畸形编号）', () => {
    const source = workOrderCodeRegexSource('2026-10-09');
    const regex = new RegExp(source);
    expect(regex.test('WO-20261009-001')).toBe(true);
    expect(regex.test('WO-20261009-999')).toBe(true);
    expect(regex.test('WO-20261009-1000')).toBe(false);
    expect(regex.test('WO-20261009-abc')).toBe(false);
    expect(regex.test('WO-20261009-01')).toBe(false);
    expect(regex.test('WO-20261010-001')).toBe(false);
  });

  it('正则中的连字符被转义（不会被当作字符区间）', () => {
    expect(workOrderCodeRegexSource('2026-10-09')).toBe('^WO\\-20261009\\-[0-9]{3}$');
  });

  it('解析序号可与格式化互逆', () => {
    for (const seq of [1, 7, 10, 100, 999]) {
      const code = formatWorkOrderCode('2026-10-09', seq);
      expect(parseWorkOrderSeq(code, '2026-10-09')).toBe(seq);
    }
  });

  it('解析失败返回 null（前缀不符 / 位数不符）', () => {
    expect(parseWorkOrderSeq('WO-20261010-001', '2026-10-09')).toBeNull();
    expect(parseWorkOrderSeq('WO-20261009-0001', '2026-10-09')).toBeNull();
    expect(parseWorkOrderSeq('WO-20261009-abc', '2026-10-09')).toBeNull();
  });

  it('日序号上限为 999（耗尽后由服务层返回 30002，不扩充位数）', () => {
    expect(WORK_ORDER_MAX_SEQ).toBe(999);
  });
});
