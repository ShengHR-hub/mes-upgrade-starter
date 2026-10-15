/**
 * 健康检查不接受任何查询参数。
 *
 * 该空 DTO 的唯一用途：配合全局 `ValidationPipe` 的
 * `whitelist: true` + `forbidNonWhitelisted: true`，
 * 把 `/api/v1/health?unexpectedField=1` 这类未知字段按契约 §3 拒绝为 10001，
 * 落实契约 §2.1「所有请求拒绝未知字段」。
 */
export class HealthQueryDto {}
