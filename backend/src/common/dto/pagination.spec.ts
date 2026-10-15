import { ErrorCode } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { normalizePagination } from './pagination.js';

function capture(fn: () => unknown): BusinessException | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error as BusinessException;
  }
}

describe('normalizePagination', () => {
  it('缺省为 page=1 / pageSize=20', () => {
    expect(normalizePagination()).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('数字字符串按整数解析并换算 skip/take', () => {
    expect(normalizePagination({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
      skip: 100,
      take: 50,
    });
  });

  it('空串视为未提供，取默认值', () => {
    expect(normalizePagination({ page: '', pageSize: '' })).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });

  describe('严格拒绝非法输入（统一抛 10001）', () => {
    const cases: Array<[string, unknown]> = [
      ['page=abc（非数字）', { page: 'abc' }],
      ['page=-1（负数）', { page: '-1' }],
      ['page=+1（带符号）', { page: '+1' }],
      ['page=1.5（小数）', { page: '1.5' }],
      ['page=1e3（科学计数）', { page: '1e3' }],
      ['page=0x10（十六进制）', { page: '0x10' }],
      ['page=" 1 "（含空格）', { page: ' 1 ' }],
      ['pageSize[]=10（数组形态）', { pageSize: ['10'] }],
      ['pageSize={}（对象形态）', { pageSize: {} }],
      ['page=9007199254740993（超出安全整数）', { page: '9007199254740993' }],
      ['page=0（下界越界）', { page: '0' }],
      ['pageSize=0（下界越界）', { pageSize: '0' }],
      ['pageSize=101（上界越界）', { pageSize: '101' }],
    ];

    for (const [title, query] of cases) {
      it(title, () => {
        const error = capture(() => normalizePagination(query as Record<string, unknown>));
        expect(error).toBeInstanceOf(BusinessException);
        expect(error?.code).toBe(ErrorCode.INVALID_ARGUMENT);
        expect(error?.getStatus()).toBe(400);
      });
    }
  });

  it('边界值 1 与 100 合法', () => {
    expect(normalizePagination({ page: '1', pageSize: '100' })).toEqual({
      page: 1,
      pageSize: 100,
      skip: 0,
      take: 100,
    });
  });

  describe('skip 计算结果越界（page × pageSize 相乘后仍可能超出安全整数）', () => {
    const max = String(Number.MAX_SAFE_INTEGER); // 9007199254740991

    it('page=MAX_SAFE_INTEGER + pageSize=1 → skip 仍安全，合法', () => {
      const result = normalizePagination({ page: max, pageSize: '1' });
      expect(result.page).toBe(Number.MAX_SAFE_INTEGER);
      expect(result.skip).toBe(Number.MAX_SAFE_INTEGER - 1);
      expect(Number.isSafeInteger(result.skip)).toBe(true);
    });

    it('page=MAX_SAFE_INTEGER + 默认 pageSize=20 → skip 越界，抛 10001', () => {
      const error = capture(() => normalizePagination({ page: max }));
      expect(error).toBeInstanceOf(BusinessException);
      expect(error?.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(error?.getStatus()).toBe(400);
      expect(error?.data).toEqual({
        errors: [
          { field: 'page', reason: 'page 与 pageSize 组合计算出的偏移量超出安全整数范围' },
        ],
      });
    });

    it('page=MAX_SAFE_INTEGER + pageSize=2 → skip 越界，抛 10001', () => {
      expect(capture(() => normalizePagination({ page: max, pageSize: '2' }))?.code).toBe(
        ErrorCode.INVALID_ARGUMENT,
      );
    });

    it('page=MAX_SAFE_INTEGER + pageSize=100 → skip 越界，抛 10001', () => {
      expect(capture(() => normalizePagination({ page: max, pageSize: '100' }))?.code).toBe(
        ErrorCode.INVALID_ARGUMENT,
      );
    });

    it('边界：pageSize=100 时最大的合法 page=90071992547410（skip=9007199254740900）', () => {
      const result = normalizePagination({ page: '90071992547410', pageSize: '100' });
      expect(result.skip).toBe(9007199254740900);
      expect(Number.isSafeInteger(result.skip)).toBe(true);
    });

    it('边界 +1：page=90071992547411 + pageSize=100 → 抛 10001', () => {
      const error = capture(() =>
        normalizePagination({ page: '90071992547411', pageSize: '100' }),
      );
      expect(error).toBeInstanceOf(BusinessException);
      expect(error?.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(error?.getStatus()).toBe(400);
      expect(error?.data).toEqual({
        errors: [
          { field: 'page', reason: 'page 与 pageSize 组合计算出的偏移量超出安全整数范围' },
        ],
      });
    });
  });
});
