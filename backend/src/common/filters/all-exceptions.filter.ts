import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, ERROR_CODE_MESSAGE, HTTP_STATUS_ERROR_CODE } from '../constants/error-code.js';
import type { FieldError } from '../dto/api-response.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { getRequestId, type RequestWithId } from '../middleware/request-id.middleware.js';
import { redactForLog } from '../utils/redact.util.js';

/**
 * NestJS / Express 内建异常的默认英文文案。
 * 命中这些文案时改用契约错误码表的中文标准文案，避免响应里出现框架原文。
 */
const FRAMEWORK_DEFAULT_MESSAGES: ReadonlySet<string> = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Method Not Allowed',
  'Not Acceptable',
  'Conflict',
  'Unsupported Media Type',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
  'Service Unavailable',
  'Gateway Timeout',
]);

/** Express 路由未命中时的默认文案，形如 `Cannot GET /api/v1/xxx`。 */
const ROUTE_MISS_PATTERN = /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;

function isBusinessMessage(text: string): boolean {
  return !FRAMEWORK_DEFAULT_MESSAGES.has(text) && !ROUTE_MISS_PATTERN.test(text);
}

function describe(exception: unknown): string {
  if (exception instanceof Error) {
    return `${exception.name}: ${exception.message}\n${exception.stack ?? ''}`;
  }
  return String(exception);
}

/**
 * 全局异常过滤器 —— 契约 §2.2 / §3。
 *
 * 任何未捕获异常（含 NestJS 内建 HttpException、未知运行时错误）都会被
 * 归一成 `{code, message, data}`；HTTP 状态由错误码映射表推导。
 *
 * 文案策略：
 * - 4xx：使用错误码表的中文标准文案；仅当异常携带**业务自定义**文案
 *   （非框架默认英文）时才覆盖。
 * - **5xx：message 一律强制为错误码表的安全文案**，绝不回显异常原文或内部标记；
 *   内部详情（含堆栈）只写服务端日志。`data` 仅当 `BusinessException` 显式提供了
 *   业务级诊断数据时才保留（如 `/health` 的依赖组件状态），否则置 null。
 *
 * 日志脱敏：只记录 `request.path`（不含 query string），避免把 URL 里的
 * 敏感参数写进日志；并带上 `X-Request-Id` 以便与客户端侧日志关联。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & RequestWithId>();

    let httpStatus: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let message: string = ERROR_CODE_MESSAGE[ErrorCode.INTERNAL_ERROR] ?? '服务器内部错误';
    let data: unknown = null;
    let hasExplicitData = false;

    if (exception instanceof BusinessException) {
      httpStatus = exception.getStatus();
      code = exception.code;
      message = exception.message;
      data = exception.data;
      hasExplicitData = exception.data !== null && exception.data !== undefined;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = HTTP_STATUS_ERROR_CODE[httpStatus] ?? ErrorCode.INTERNAL_ERROR;
      message = ERROR_CODE_MESSAGE[code] ?? '请求失败';

      const body = exception.getResponse();
      if (typeof body === 'string') {
        if (isBusinessMessage(body)) message = body;
      } else if (body !== null && typeof body === 'object') {
        const payload = body as { message?: unknown };
        if (Array.isArray(payload.message)) {
          // NestJS ValidationPipe 的默认形态：message 为字符串数组
          code = ErrorCode.INVALID_ARGUMENT;
          message = ERROR_CODE_MESSAGE[ErrorCode.INVALID_ARGUMENT] ?? '参数错误';
          data = {
            errors: payload.message.map(
              (item): FieldError => ({ field: '', reason: String(item) }),
            ),
          };
          hasExplicitData = true;
        } else if (typeof payload.message === 'string' && isBusinessMessage(payload.message)) {
          message = payload.message;
        }
      }
    }

    if (httpStatus >= 500) {
      // 5xx 安全文案：绝不把内部异常文案/标记/堆栈暴露给客户端
      message = ERROR_CODE_MESSAGE[code] ?? ERROR_CODE_MESSAGE[ErrorCode.INTERNAL_ERROR] ?? '服务器内部错误';
      if (!hasExplicitData) {
        data = null;
      }
      // 日志边界脱敏（审查 P1）：异常文案 / 堆栈里若带口令、令牌、AI Key 或带凭据的连接串，
      // 一律替换为 `***` 后再落盘。请求号、方法、路径、状态码与错误码**保持原样**，不影响排查。
      this.logger.error(
        redactForLog(
          `[${getRequestId(request) ?? '-'}] ${request.method} ${request.path} -> ${httpStatus}/${code} :: ${describe(exception)}`,
        ),
      );
    }

    response.status(httpStatus).json({ code, message, data });
  }
}
