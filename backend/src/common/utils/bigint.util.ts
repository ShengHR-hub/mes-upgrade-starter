/**
 * BIGINT / 超大数 序列化工具。
 *
 * 背景（契约 §2.1）：BIGINT ID 必须以十进制字符串返回（如 `"101"`），
 * 避免超出 JavaScript `Number.MAX_SAFE_INTEGER` 后的精度损失。
 *
 * 双保险：
 * 1. 驱动层 —— mysql2 开启 `supportBigNumbers + bigNumberStrings`，BIGINT 直接以 string 返回；
 * 2. 出口层 —— 本工具在响应拦截器中兜底，把残留的 `bigint` 递归转为字符串。
 */

/** 递归把 `bigint` 转成十进制字符串，其余值原样返回。 */
export function serializeBigInt<T>(value: T): T {
  if (typeof value === 'bigint') {
    return value.toString() as unknown as T;
  }
  if (value === null || value === undefined) {
    return value;
  }
  // Date / Buffer 等内置对象保持原样，避免被展开成普通对象
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInt(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      result[key] = serializeBigInt(source[key]);
    }
    return result as unknown as T;
  }
  return value;
}
