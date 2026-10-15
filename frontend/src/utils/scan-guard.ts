/**
 * 扫码内容安全守卫（B13 任务书要求 9）。
 *
 * 铁律：扫码得到的工单编号 / SN 只是**查询关键字**：
 * - 不当作 SQL 片段、数据库连接串或任意 URL；
 * - 只允许安全的编号字符集（字母 / 数字 / 点 / 下划线 / 连字符），长度 1~64；
 * - 含空白、引号、分号、百分号、斜杠、冒号、等号、尖括号等内容一律拒绝，
 *   从源头杜绝注入与「扫码跳转任意链接」。
 *
 * 纯函数，无浏览器依赖，便于单测。
 */

/** 允许的扫码内容：编号类字符串 */
const SAFE_SCAN_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** 常见高危特征（用于给出可读的拒绝原因） */
const DANGEROUS_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/:\/\//, '包含 URL 协议'],
  [/\//, '包含路径分隔符'],
  [/[|;`$]/, '包含 Shell / SQL 元字符'],
  [/['"\\]/, '包含引号或反斜杠'],
  [/[<>=]/, '包含 SQL / HTML 比较或标签字符'],
  [/\s/, '包含空白字符'],
  [/%]/, '包含 URL 编码通配符'],
];

export interface ScanValidation {
  ok: boolean;
  /** 通过校验后的规范值（首尾空白已剥离）；未通过为 null */
  normalized: string | null;
  /** 拒绝原因（面向用户的简短说明）；通过为 null */
  reason: string | null;
}

/**
 * 校验扫码 / 手动输入的内容。
 *
 * @param raw 扫码枪或手动输入的原始文本（扫码枪通常自带回车，这里统一清洗）
 */
export function validateScanInput(raw: string): ScanValidation {
  if (typeof raw !== 'string') {
    return { ok: false, normalized: null, reason: '扫码内容不是文本' };
  }
  const normalized = raw.replace(/[\r\n\t]+/g, '').trim();
  if (normalized.length === 0) {
    return { ok: false, normalized: null, reason: '扫码内容为空' };
  }
  if (normalized.length > 64) {
    return { ok: false, normalized: null, reason: '扫码内容过长（超过 64 字符）' };
  }
  for (const [pattern, hint] of DANGEROUS_HINTS) {
    if (pattern.test(normalized)) {
      return { ok: false, normalized: null, reason: `扫码内容不安全：${hint}` };
    }
  }
  if (!SAFE_SCAN_PATTERN.test(normalized)) {
    return { ok: false, normalized: null, reason: '扫码内容含不允许的字符' };
  }
  return { ok: true, normalized, reason: null };
}
