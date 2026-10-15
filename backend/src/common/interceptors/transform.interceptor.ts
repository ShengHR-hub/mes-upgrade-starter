import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ErrorCode, ERROR_CODE_MESSAGE } from '../constants/error-code.js';
import { ApiResponse, isApiResponse } from '../dto/api-response.js';

/**
 * 统一返回包体拦截器 —— 契约 §2.2。
 *
 * 把 controller 的任意返回值包装成 `{code, message, data}`：
 * - 成功恒为 `code = 0`、`message = "成功"`；
 * - 返回值本身已是包体（例如手工调用了 `ok()`）时不重复包装；
 * - 返回 `undefined` 时归一为 `data: null`（契约：不用无包体的 204）。
 *
 * 注意：本拦截器不改写 HTTP 状态码，新建资源仍由 Nest 默认的 201 表达。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T | null>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T | null>> {
    return next.handle().pipe(
      map((data) => {
        if (isApiResponse(data)) {
          return data as ApiResponse<T | null>;
        }
        return {
          code: ErrorCode.SUCCESS,
          message: ERROR_CODE_MESSAGE[ErrorCode.SUCCESS] ?? '成功',
          data: (data === undefined ? null : data) as T | null,
        };
      }),
    );
  }
}
