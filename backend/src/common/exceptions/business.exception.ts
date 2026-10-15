import { HttpException } from '@nestjs/common';
import { ErrorCode, ERROR_CODE_HTTP_STATUS, ERROR_CODE_MESSAGE } from '../constants/error-code.js';

/**
 * 业务异常 —— 承载契约错误码。
 *
 * 用法：
 * ```ts
 * throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND);
 * throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', { errors: [...] });
 * ```
 *
 * HTTP 状态由 `ERROR_CODE_HTTP_STATUS` 自动推导，业务代码不需要关心状态码。
 * 最终由 `AllExceptionsFilter` 统一渲染为 `{code, message, data}`。
 */
export class BusinessException extends HttpException {
  /** 契约业务错误码。 */
  readonly code: ErrorCode;

  /** 附加到 `data` 的明细（可为 null）。 */
  readonly data: unknown;

  constructor(code: ErrorCode, message?: string, data: unknown = null) {
    const httpStatus = ERROR_CODE_HTTP_STATUS[code] ?? 500;
    super(message ?? ERROR_CODE_MESSAGE[code] ?? '业务异常', httpStatus);
    this.code = code;
    this.data = data;
  }
}
