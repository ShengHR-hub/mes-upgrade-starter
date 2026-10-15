import { describe, expect, it } from 'vitest';

import { mysqlDatetimeToRfc3339, parseRfc3339, toMysqlDatetime } from './rfc3339.util.js';

describe('parseRfc3339 —— 严格 RFC 3339（契约 §2.1）', () => {
  it('接受带时区偏移的合法时间', () => {
    const parsed = parseRfc3339('2026-10-09T08:30:00+08:00');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe('2026-10-09T00:30:00.000Z');
  });

  it('接受 Z 与小数秒', () => {
    expect(parseRfc3339('2026-10-09T00:30:00Z')).toBeInstanceOf(Date);
    expect(parseRfc3339('2026-10-09T08:30:00.123+08:00')).toBeInstanceOf(Date);
  });

  it('拒绝缺少时区偏移的时间（必须显式带时区）', () => {
    expect(parseRfc3339('2026-10-09T08:30:00')).toBeNull();
    expect(parseRfc3339('2026-10-09 08:30:00')).toBeNull();
  });

  it('拒绝不存在的日历日与越界的时分秒', () => {
    expect(parseRfc3339('2026-02-31T08:30:00+08:00')).toBeNull();
    expect(parseRfc3339('2026-10-09T24:00:00+08:00')).toBeNull();
    expect(parseRfc3339('2026-10-09T08:60:00+08:00')).toBeNull();
    expect(parseRfc3339('2026-10-09T08:30:61+08:00')).toBeNull();
  });

  it('拒绝非字符串与空值', () => {
    expect(parseRfc3339(null)).toBeNull();
    expect(parseRfc3339(undefined)).toBeNull();
    expect(parseRfc3339(12345)).toBeNull();
  });
});

describe('MySQL DATETIME 互转', () => {
  it('Date → DATETIME 字面量使用 Asia/Shanghai 墙钟', () => {
    const date = new Date('2026-10-09T00:30:00.000Z'); // = 08:30 +08:00
    expect(toMysqlDatetime(date)).toBe('2026-10-09 08:30:00');
  });

  it('DATETIME 字面量 → RFC 3339（补 +08:00）', () => {
    expect(mysqlDatetimeToRfc3339('2026-10-09 08:30:00')).toBe('2026-10-09T08:30:00+08:00');
  });

  it('null 原样返回 null（不变成 0 或空串）', () => {
    expect(mysqlDatetimeToRfc3339(null)).toBeNull();
  });

  it('往返一致', () => {
    const literal = '2026-10-09 08:30:00';
    const roundTrip = toMysqlDatetime(new Date(mysqlDatetimeToRfc3339(literal)!));
    expect(roundTrip).toBe(literal);
  });
});
