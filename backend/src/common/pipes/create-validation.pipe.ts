import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ErrorCode } from '../constants/error-code.js';
import type { FieldError } from '../dto/api-response.js';
import { BusinessException } from '../exceptions/business.exception.js';

/** class-validator 在 whitelist 命中时使用的约束键名。 */
const WHITELIST_CONSTRAINT = 'whitelistValidation';

function flatten(errors: readonly ValidationError[], parent = ''): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;

    for (const [key, text] of Object.entries(error.constraints ?? {})) {
      result.push({
        field,
        reason: key === WHITELIST_CONSTRAINT ? '未知字段，请求被拒绝' : text,
      });
    }

    if (error.children && error.children.length > 0) {
      result.push(...flatten(error.children, field));
    }
  }
  return result;
}

/**
 * 全局参数校验管道 —— 契约 §2.1「所有请求拒绝未知字段」。
 *
 * - `whitelist`：剥离未声明属性；
 * - `forbidNonWhitelisted`：不静默剥离，直接拒绝（未知字段 → 10001）；
 * - `transform`：按 DTO 类型实例化，便于后续模块用 `@Type()` 做嵌套转换；
 * - `exceptionFactory`：统一抛出 `BusinessException`，使响应体严格符合
 *   契约 §2.2 的 `{"code":10001,"message":"参数错误","data":{"errors":[...]}}`。
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BusinessException(ErrorCode.INVALID_ARGUMENT, undefined, { errors: flatten(errors) }),
  });
}
