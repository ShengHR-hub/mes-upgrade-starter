/**
 * 日志脱敏（纯函数）。
 *
 * 背景（S5 审查第一轮补充意见 P1）：
 * 全局异常过滤器在 5xx 分支会把异常的 `message` 与**堆栈**原样写进服务端日志。
 * 当异常文本里带有凭据（数据库口令、服务令牌、AI Key、JWT、带凭据的连接串）时，
 * 这些内容会以明文落到日志文件里 —— 与项目「凭据不落盘」的口径冲突。
 *
 * 本模块在**日志边界**做兜底脱敏：
 * - 只处理"看起来像凭据"的片段，**保留**请求号、错误分类、状态码、路径、主机名等排查所需信息；
 * - 不试图改写业务语义，也不影响返回给客户端的响应体（响应体由异常过滤器另行安全化）。
 *
 * 原则：**宁可多脱敏，不可漏脱敏**（日志里少一点上下文，好过泄漏一个口令）。
 */

/** 形如 `scheme://user:pass@host` 的连接串：整段 userinfo 一律替换 */
const CONNECTION_STRING_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/**
 * 敏感键的 `key=value` / `key: value` / `"key": value` 形式。
 *
 * 三个易错点（都在审查中被指出/覆盖）：
 * 1. **键名允许前后缀**：`\b` 在 `_` 两侧不成立，只写 `password` 会漏掉 `DB_PASSWORD`；
 *    同理 `token` 覆盖 `accessToken` / `AI_SERVICE_TOKEN` 等。
 * 2. **键名可能是带引号的 JSON 键**：`{"password":"x"}` 里键后跟的是 `"` 而不是 `:`，
 *    若不允许引号则整条规则失配、敏感值原样进日志。
 *    因此键两侧各放一个可选的引号捕获组，并在其后才要求 `:` / `=`。
 * 3. **值内的转义引号**（审查第四轮 P1）：旧值模式 `"[^"]*"` 在 `\"` 处提前收尾，
 *    `{"password":"ab\"TAIL"}` 只替换到 `ab\"`，后缀 `TAIL` 原样进日志。
 *    引号值改为 `"(?:[^"\\]|\\.)*"`：逐字符消费，遇到 `\\` 连同下一字符一起跳过，
 *    从而跨越转义引号、匹配到**真正的**收尾引号。
 */
const SENSITIVE_KEY_VALUE =
  /(["']?)\b([A-Za-z0-9_]*(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|authorization|credential|private[_-]?key)[A-Za-z0-9_]*)\b(["']?)(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)\]}"']+)/gi;

/** `Authorization: Bearer xxx` / `Basic xxx` 的裸形态 */
const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** JWT（三段 base64url） */
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [CONNECTION_STRING_USERINFO, '$1***@'],
  // ⚠️ 顺序关键：`Authorization: Bearer xxx` 必须先由 AUTH_SCHEME_VALUE 处理，
  // 否则 SENSITIVE_KEY_VALUE 只会吃掉 `Bearer` 这个词、把后面的令牌原样留下。
  [AUTH_SCHEME_VALUE, '$1 ***'],
  [SENSITIVE_KEY_VALUE, '$1$2$3$4***'],
  [JWT_LIKE, '***JWT***'],
];

/** 对任意值做日志脱敏，返回可安全写入日志的字符串 */
export function redactForLog(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input);
  let output = text;
  for (const [pattern, replacement] of RULES) {
    output = output.replace(pattern, replacement);
  }
  return output;
}
