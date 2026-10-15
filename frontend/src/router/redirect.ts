/**
 * 返回地址（redirect）清洗 —— 防开放重定向（S4 要求第 4 条）。
 *
 * 规则：只接受「应用内部路由」。
 * 拒绝：非字符串、空串、不以 `/` 开头、协议相对地址 `//host`、反斜杠变体、
 * 含控制字符或空白的地址、以及 `/javascript:` 这类伪内部地址。
 *
 * 说明：路径部分允许非 ASCII（例如带中文 keyword 的查询串），
 * 因为返回地址只会交给 `router.replace()` 处理，不会赋给 `window.location`。
 */

export const DEFAULT_REDIRECT = '/'

/** 以单个 `/` 开头，且第二个字符不是 `/` 或 `\`；整体不含空白与控制字符 */
const INTERNAL_PATH_PATTERN = /^\/(?![/\\])[^\s\u0000-\u001f\u007f\\]*$/
const SCHEME_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/

export function sanitizeRedirect(raw: unknown, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof raw !== 'string') return fallback

  const value = raw.trim()
  if (value.length === 0) return fallback

  if (!INTERNAL_PATH_PATTERN.test(value)) return fallback
  // 伪内部地址：/javascript:alert(1)、/data:text/html,...
  if (SCHEME_PREFIX_PATTERN.test(value.slice(1))) return fallback

  return value
}
