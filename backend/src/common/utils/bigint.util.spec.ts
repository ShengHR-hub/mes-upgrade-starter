import { serializeBigInt } from './bigint.util.js';

describe('serializeBigInt', () => {
  it('bigint 转十进制字符串', () => {
    expect(serializeBigInt(101n)).toBe('101');
    expect(serializeBigInt(9007199254740993n)).toBe('9007199254740993');
  });

  it('嵌套对象与数组递归转换', () => {
    expect(serializeBigInt({ id: 101n, list: [{ saleOrderId: 9n }] })).toEqual({
      id: '101',
      list: [{ saleOrderId: '9' }],
    });
  });

  it('Date 保持原样不被展开', () => {
    const now = new Date();
    expect(serializeBigInt(now)).toBe(now);
  });

  it('null / undefined / 普通原始值不变', () => {
    expect(serializeBigInt(null)).toBeNull();
    expect(serializeBigInt(undefined)).toBeUndefined();
    expect(serializeBigInt(1)).toBe(1);
    expect(serializeBigInt('a')).toBe('a');
  });
});
