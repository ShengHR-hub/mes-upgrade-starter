import {
  toRfc3339,
  toShanghaiDate,
  toShanghaiRfc3339,
  toShanghaiSqlDateTime,
} from './datetime.util.js';

describe('datetime.util', () => {
  const sample = new Date('2026-10-09T00:30:00.000Z');

  it('toShanghaiRfc3339 输出 +08:00 偏移', () => {
    expect(toShanghaiRfc3339(sample)).toBe('2026-10-09T08:30:00.000+08:00');
  });

  it('toShanghaiDate 按业务时区取日期（跨日不串位）', () => {
    // UTC 2026-10-09 00:30 == 北京时间 2026-10-09 08:30
    expect(toShanghaiDate(sample)).toBe('2026-10-09');
    // UTC 2026-10-08 20:00 == 北京时间 2026-10-09 04:00
    expect(toShanghaiDate(new Date('2026-10-08T20:00:00.000Z'))).toBe('2026-10-09');
  });

  it('toShanghaiSqlDateTime 输出 YYYY-MM-DD HH:mm:ss 格式', () => {
    expect(toShanghaiSqlDateTime(sample)).toBe('2026-10-09 08:30:00');
  });

  it('toRfc3339 支持负偏移与零偏移', () => {
    expect(toRfc3339(sample, 0)).toBe('2026-10-09T00:30:00.000+00:00');
    expect(toRfc3339(sample, -300)).toBe('2026-10-08T19:30:00.000-05:00');
  });
});
