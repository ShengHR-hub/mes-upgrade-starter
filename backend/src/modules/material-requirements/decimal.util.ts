/**
 * B12 毛需求的精确十进制计算（契约 §6.10）。
 *
 * 为什么用 BigInt 缩放整数而不是 JS number：
 * - BOM `qty` 为 DECIMAL(10,2)，订单 `qty` 为 INT；极端值相乘（约 2^31 × 10^10）
 *   会超出 IEEE-754 双精度安全整数范围（2^53），JS number 会静默丢失精度；
 * - 缩放成整数后用 BigInt 运算全程精确，最后格式化为**十进制字符串**返回
 *   （契约 §2.1：DECIMAL 用字符串，例如 "200.00"）。
 */

const SCALE = 2;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** 把 MySQL DECIMAL 字符串（如 "2.00"）解析为缩放整数（200n） */
export function parseDecimalToScaled(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toFixed(SCALE) : String(value).trim();
  const normalized = text.startsWith('-') ? text.slice(1) : text;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`非法十进制值：${text}`);
  }
  const [intPart, fracPart = ''] = normalized.split('.');
  const frac = fracPart.padEnd(SCALE, '0');
  return BigInt(`${intPart}${frac}`);
}

/** 把缩放整数格式化为固定 2 位小数的十进制字符串（如 20000n → "200.00"） */
export function formatScaledDecimal(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  const frac = fracPart.toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${intPart}.${frac}`;
}

/** 订单数量（整数）× BOM 用量（缩放整数）→ 毛需求缩放整数 */
export function multiplyQty(orderQty: number, bomQtyScaled: bigint): bigint {
  return BigInt(Math.trunc(orderQty)) * bomQtyScaled;
}
