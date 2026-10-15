import { ErrorCode } from '../constants/error-code.js';
import type { FieldError } from '../dto/api-response.js';
import { BusinessException } from '../exceptions/business.exception.js';

/**
 * 参数校验辅助 —— 统一产出契约 §2.2 的错误明细形状：
 * `{"code":10001,"message":"参数错误","data":{"errors":[{"field":…,"reason":…}]}}`
 */
export function fieldError(field: string, reason: string): FieldError {
  return { field, reason };
}

/** 构造 10001 参数错误（可带多条明细） */
export function invalidArgument(...errors: FieldError[]): BusinessException {
  return new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', { errors });
}

/** 构造 10002 关联对象不存在 */
export function invalidReference(field: string, reason: string): BusinessException {
  return new BusinessException(ErrorCode.INVALID_REFERENCE, '关联对象不存在', {
    errors: [fieldError(field, reason)],
  });
}

/**
 * 断言辅助：条件不满足时抛出 10001。
 * 使用 `asserts` 签名让 TS 在后续代码中收窄类型。
 */
export function assertField(
  condition: unknown,
  field: string,
  reason: string,
): asserts condition {
  if (!condition) throw invalidArgument(fieldError(field, reason));
}

/**
 * 转义 LIKE 模式中的通配符，避免用户输入被当作模式语法。
 * 配套 SQL 使用 `LIKE ? ESCAPE '\\'`。
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** 判断是否为 MySQL 唯一键冲突（错误码 1062 / ER_DUP_ENTRY） */
export function isDuplicateKeyError(error: unknown): boolean {
  return hasMysqlErrorCode(error, ['ER_DUP_ENTRY'], [1062]);
}

/**
 * 判断是否为「可安全重试整个事务」的并发错误。
 *
 * - `ER_LOCK_DEADLOCK`（1213）：InnoDB 检测到死锁并**回滚整个事务**，重跑即可；
 * - `ER_LOCK_WAIT_TIMEOUT`（1205）：锁等待超时，同样会回滚事务。
 *
 * ⚠️ 只返回「整个事务可重跑」的信号；调用方必须保证重跑是幂等的
 * （例如订单确认会先检查既有工单，因此可安全重跑）。
 */
export function isRetryableTransactionError(error: unknown): boolean {
  return hasMysqlErrorCode(error, ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'], [1213, 1205]);
}

function hasMysqlErrorCode(error: unknown, codes: readonly string[], errnos: readonly number[]): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    driverError?: { code?: unknown; errno?: unknown };
  };
  const code = candidate.driverError?.code ?? candidate.code;
  const errno = candidate.driverError?.errno ?? candidate.errno;
  return (
    (typeof code === 'string' && codes.includes(code)) ||
    (typeof errno === 'number' && errnos.includes(errno))
  );
}
