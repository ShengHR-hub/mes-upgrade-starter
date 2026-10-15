import { describe, expect, it } from 'vitest';

import {
  escapeLikePattern,
  isDuplicateKeyError,
  isRetryableTransactionError,
} from './validation.util.js';

/** 构造 mysql2 / TypeORM 形态的错误 */
function mysqlError(code: string, errno: number, nested = false): unknown {
  return nested ? { driverError: { code, errno } } : { code, errno };
}

describe('isDuplicateKeyError —— 唯一键冲突（1062 / ER_DUP_ENTRY）', () => {
  it('识别嵌套与平铺两种形态', () => {
    expect(isDuplicateKeyError(mysqlError('ER_DUP_ENTRY', 1062))).toBe(true);
    expect(isDuplicateKeyError(mysqlError('ER_DUP_ENTRY', 1062, true))).toBe(true);
  });

  it('仅凭 code 或 errno 之一也能识别', () => {
    expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
  });

  it('其他错误不误判', () => {
    expect(isDuplicateKeyError(mysqlError('ER_LOCK_DEADLOCK', 1213))).toBe(false);
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
    expect(isDuplicateKeyError('ER_DUP_ENTRY')).toBe(false);
  });
});

describe('isRetryableTransactionError —— 可安全重跑整个事务的并发错误', () => {
  it('识别 InnoDB 死锁 1213', () => {
    expect(isRetryableTransactionError(mysqlError('ER_LOCK_DEADLOCK', 1213))).toBe(true);
    expect(isRetryableTransactionError(mysqlError('ER_LOCK_DEADLOCK', 1213, true))).toBe(true);
  });

  it('识别锁等待超时 1205', () => {
    expect(isRetryableTransactionError(mysqlError('ER_LOCK_WAIT_TIMEOUT', 1205))).toBe(true);
  });

  it('唯一键冲突不属于"整事务可重跑"（由语句级重试处理）', () => {
    expect(isRetryableTransactionError(mysqlError('ER_DUP_ENTRY', 1062))).toBe(false);
  });

  it('业务异常与普通错误不误判（否则会把 30003/30005 也重试掉）', () => {
    expect(isRetryableTransactionError(new Error('业务异常'))).toBe(false);
    expect(isRetryableTransactionError({ code: 'ER_NO_SUCH_TABLE', errno: 1146 })).toBe(false);
    expect(isRetryableTransactionError(null)).toBe(false);
    expect(isRetryableTransactionError({ driverError: {} })).toBe(false);
  });
});

describe('escapeLikePattern —— 防止用户输入被当作 LIKE 通配符', () => {
  it('转义 %、_ 与反斜杠', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('普通文本原样返回', () => {
    expect(escapeLikePattern('SO-20261010-001')).toBe('SO-20261010-001');
  });
});
