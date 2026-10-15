import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/** 契约 §2.2：追踪标识放 `X-Request-Id` 响应头，不增加顶层响应字段。 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** 只接受安全字符集与合理长度，防止客户端注入非法内容到日志/响应头。 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export type RequestWithId = Request & { requestId?: string };

const logger = new Logger('HTTP');

/**
 * 为每个请求生成（或沿用合法的）requestId：
 * 1. 写入 `req.requestId`，供异常过滤器关联日志；
 * 2. 通过 `X-Request-Id` 响应头返回；
 * 3. 记录一条请求日志。
 *
 * 以 Express 级中间件（`app.use`）注册，先于路由匹配执行，
 * 因此 404 等「无匹配路由」的响应同样带上该头。
 */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const requestId =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  logger.log(`[${requestId}] ${req.method} ${req.path}`);

  next();
}

/** 从请求对象安全取出 requestId（异常过滤器使用）。 */
export function getRequestId(req: unknown): string | undefined {
  if (req !== null && typeof req === 'object' && 'requestId' in req) {
    const value = (req as RequestWithId).requestId;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}
