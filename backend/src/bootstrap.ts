import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { requestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { createValidationPipe } from './common/pipes/create-validation.pipe.js';

/**
 * 应用级横切配置（启动与 e2e 测试共用，保证两条路径行为一致）。
 *
 * 全局规范（契约 §2）：
 * - `X-Request-Id` 追踪头 + 请求日志    → requestIdMiddleware
 * - 拒绝未知字段 / 参数校验             → createValidationPipe
 * - 统一返回包体 `{code, message, data}` → TransformInterceptor
 * - BIGINT 转十进制字符串               → BigIntSerializerInterceptor
 * - 统一错误码表 + 5xx 安全文案         → AllExceptionsFilter
 *
 * 注册顺序说明：中间件用 `app.use` 挂到 Express 层，先于路由匹配执行，
 * 因此 404 等无匹配路由的响应也会带上 `X-Request-Id`。
 */
export function configureApp(app: INestApplication): void {
  app.use(requestIdMiddleware);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new BigIntSerializerInterceptor(), new TransformInterceptor());
}
