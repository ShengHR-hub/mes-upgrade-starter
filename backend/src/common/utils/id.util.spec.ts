import { describe, expect, it } from 'vitest';

import { isValidDecimalId, MAX_BIGINT_VALUE } from './id.util.js';

describe('isValidDecimalId —— BIGINT ID 的字符串校验（禁止 Number 转换）', () => {
  it('接受正整数十进制字符串', () => {
    expect(isValidDecimalId('1')).toBe(true);
    expect(isValidDecimalId('101')).toBe(true);
    expect(isValidDecimalId('9007199254740993')).toBe(true); // 超出 Number 安全整数仍应接受
    expect(isValidDecimalId('9223372036854775807')).toBe(true); // BIGINT 有符号上限
  });

  it('拒绝前导零 / 零 / 符号 / 小数 / 科学计数法 / 空白', () => {
    expect(isValidDecimalId('0')).toBe(false);
    expect(isValidDecimalId('007')).toBe(false);
    expect(isValidDecimalId('-1')).toBe(false);
    expect(isValidDecimalId('+1')).toBe(false);
    expect(isValidDecimalId('1.0')).toBe(false);
    expect(isValidDecimalId('1e3')).toBe(false);
    expect(isValidDecimalId(' 1')).toBe(false);
    expect(isValidDecimalId('1 ')).toBe(false);
    expect(isValidDecimalId('')).toBe(false);
  });

  it('拒绝非字符串类型（路径参数之外的误用）', () => {
    expect(isValidDecimalId(101)).toBe(false);
    expect(isValidDecimalId(null)).toBe(false);
    expect(isValidDecimalId(undefined)).toBe(false);
    expect(isValidDecimalId(['101'])).toBe(false);
  });
});

describe('isValidDecimalId —— BIGINT 容量上限（审查 P2 回归）', () => {
  it('恰好等于 BIGINT 有符号上限时接受', () => {
    expect(isValidDecimalId('9223372036854775807')).toBe(true); // 2^63 - 1
  });

  it('**上限 +1 必须拒绝**（同为 19 位，只查位数会漏）', () => {
    expect(isValidDecimalId('9223372036854775808')).toBe(false); // 2^63
  });

  it('明显越界的 19 位数字同样拒绝', () => {
    expect(isValidDecimalId('9999999999999999999')).toBe(false);
  });

  it('上限边界前后一致（-1 接受 / +1 拒绝）', () => {
    const max = 9223372036854775807n;
    expect(isValidDecimalId(String(max - 1n))).toBe(true);
    expect(isValidDecimalId(String(max))).toBe(true);
    expect(isValidDecimalId(String(max + 1n))).toBe(false);
  });

  it('导出上限常量供文档与测试引用', () => {
    expect(MAX_BIGINT_VALUE).toBe(9223372036854775807n);
  });
});
