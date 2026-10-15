import { describe, expect, it } from 'vitest';

import {
  formatScaledDecimal,
  multiplyQty,
  parseDecimalToScaled,
} from './decimal.util.js';

/** B12 精确十进制单测（契约 §2.1 DECIMAL 字符串口径） */
describe('parseDecimalToScaled / formatScaledDecimal', () => {
  it('"2.00" → 200n → "2.00"（往返一致）', () => {
    expect(parseDecimalToScaled('2.00')).toBe(200n);
    expect(formatScaledDecimal(200n)).toBe('2.00');
  });

  it('缺省小数位按 2 位补齐', () => {
    expect(parseDecimalToScaled('3')).toBe(300n);
    expect(parseDecimalToScaled('0.5')).toBe(50n);
  });

  it('大数量不丢精度（超出 JS number 安全整数范围 2^53）', () => {
    // INT 上限 2147483647 × DECIMAL(10,2) 上限 99999999.99
    // = 214748364678525163.53（scaled = 21474836467852516353n > 2^53）
    const gross = multiplyQty(2147483647, parseDecimalToScaled('99999999.99'));
    expect(gross).toBe(21474836467852516353n);
    expect(formatScaledDecimal(gross)).toBe('214748364678525163.53');
  });
});

describe('multiplyQty（订单数量 × BOM 用量）', () => {
  it('100 × "2.00" = "200.00"', () => {
    expect(formatScaledDecimal(multiplyQty(100, parseDecimalToScaled('2.00')))).toBe('200.00');
  });
});
