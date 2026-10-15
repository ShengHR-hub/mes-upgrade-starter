/**
 * BIGINT 主键（路径参数 / 外键）的字符串校验工具。
 *
 * 契约 §2.1：BIGINT ID 使用十进制字符串（如 `"101"`），避免 JavaScript 精度损失。
 * 因此：
 * - 路径参数**只在字符串层面校验与传递**，绝不 `Number(id)`；
 * - 服务端不接受科学计数法、正负号、前导零、空格等歧义写法。
 */

/** 正整数十进制字面量：1 ~ 19 位（BIGINT 有符号上限为 19 位） */
export const DECIMAL_ID_PATTERN = /^[1-9]\d{0,18}$/;

/** MySQL `BIGINT SIGNED` 上限（2^63 − 1） */
export const MAX_BIGINT_VALUE = 9223372036854775807n;

/**
 * 是否为可安全作为 BIGINT ID 使用的十进制字符串。
 *
 * 两层校验：
 * 1. **形态**：拒绝前导零 / 零 / 正负号 / 小数 / 科学计数法 / 空白 / 非字符串；
 * 2. **容量**：19 位数字**未必**落在 BIGINT 有符号范围内 ——
 *    `9223372036854775808` 同样是 19 位，但已越界。
 *    只限位数会把容量校验推迟到数据库（`ER_WARN_DATA_OUT_OF_RANGE` / 驱动报错），
 *    而不是干净的 10001（审查 P2：「BIGINT 容量校验只限制位数」）。
 *
 * 用 `BigInt` 比较：正则已把长度限制在 19 位以内，不会出现超大字符串。
 */
export function isValidDecimalId(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_ID_PATTERN.test(value)) return false;
  return BigInt(value) <= MAX_BIGINT_VALUE;
}
