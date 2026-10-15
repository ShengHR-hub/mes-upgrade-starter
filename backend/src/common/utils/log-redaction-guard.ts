/**
 * 日志脱敏覆盖检查（纯函数，供静态守卫用例使用）。
 *
 * 判据演进（审查驱动）：
 * - 第三轮 P1：要求每个 `logger.error/warn` 调用点出现 `redactForLog(` —— 太宽松；
 * - 第四轮 P2：改为"调用点 400 字符窗口内出现" —— 未脱敏调用后紧跟已脱敏调用会被放行；
 * - 第四轮修复：实参必须**直接以 `redactForLog(` 开头** —— 仍不完整；
 * - 第五轮 P2（本版）：必须校验**完整调用表达式**——
 *   ① 实参整体是且仅是一个 `redactForLog(...)` 调用（其后拼接原文如
 *      `redactForLog(safe) + raw` 判违规）；
 *   ② **不得有第二个及之后的实参**（NestJS Logger 的第二参是 stack，
 *      `logger.error(redactForLog(safe), rawStack)` 会把原始异常堆栈原样落日志，判违规）。
 *
 * 实现上用一个小型扫描器对实参区间做括号配对（正确跳过字符串/模板字面量——含
 * `${}` 内嵌与转义——以及行/块注释），避免被内容里的引号、括号干扰。
 *
 * 宁可误报让开发者补全包裹，也不放过任何未脱敏的通道。
 */

/** 匹配 `logger.error(` / `logger.warn(`（含 `this.logger.` 前缀与直接调用两种写法） */
export const LOG_CALL = /(?:this\.)?logger\.(error|warn)\s*\(/g;

export interface UnredactedLogCall {
  /** 1 起始行号 */
  line: number;
  /** 日志级别：error / warn */
  level: string;
  /** 违规原因（便于定位修复） */
  reason: 'args-not-wrapped' | 'concat-after-redaction' | 'extra-args';
}

const REDACT_FOR_LOG = 'redactForLog';

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/** 跳过字符串字面量（含转义），返回结束后的下标 */
function skipStringLiteral(source: string, i: number, quote: string): number {
  i += 1; // 开引号
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** 跳过模板字面量（含 `${}` 内嵌表达式，其中可再含字符串/模板/括号） */
function skipTemplateLiteral(source: string, i: number): number {
  i += 1; // 开反引号
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') return i + 1;
    if (ch === '$' && source[i + 1] === '{') {
      i = skipBalanced(source, i + 1, '{', '}');
      continue;
    }
    i += 1;
  }
  return i;
}

/** 若 source[i] 处是注释则跳过并返回结束下标；否则原样返回 i */
function skipComment(source: string, i: number): number {
  if (source[i] === '/' && source[i + 1] === '/') {
    while (i < source.length && source[i] !== '\n') i += 1;
    return i;
  }
  if (source[i] === '/' && source[i + 1] === '*') {
    i += 2;
    while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
    return Math.min(i + 2, source.length);
  }
  return i;
}

/** 从 openIndex（指向开括号）扫描到配对的闭括号下标；找不到返回 -1 */
function skipBalanced(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      i = skipStringLiteral(source, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(source, i);
      continue;
    }
    const afterComment = skipComment(source, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** 跳过空白与注释 */
function skipTrivia(source: string, i: number): number {
  for (;;) {
    while (i < source.length && isWhitespace(source[i])) i += 1;
    const after = skipComment(source, i);
    if (after === i) return i;
    i = after;
  }
}

/**
 * 判定 `logger.error/warn(` 之后的实参区间是否为**整体脱敏**：
 * 实参必须是单个 `redactForLog(...)` 调用，其后允许**尾随逗号**（`redactForLog(x),` = 无第二实参），
 * 再往后必须直接是本 logger 调用的收尾 `)` —— 即不允许拼接、也不允许第二个实参。
 */
function isWhollyRedacted(source: string, argsStart: number): boolean {
  let i = skipTrivia(source, argsStart);

  if (!source.startsWith(REDACT_FOR_LOG, i)) return false;
  i = skipTrivia(source, i + REDACT_FOR_LOG.length);
  if (source[i] !== '(') return false;

  const close = skipBalanced(source, i, '(', ')');
  if (close === -1) return false;

  let tail = skipTrivia(source, close + 1);
  if (source[tail] === ',') tail = skipTrivia(source, tail + 1); // 尾随逗号：合法，无第二实参
  return source[tail] === ')';
}

/**
 * 扫描源码，返回所有「实参未被 redactForLog 整体包裹 / 在脱敏结果上拼接 /
 * 存在第二个实参」的 logger.error/warn 调用点。
 */
export function findUnredactedLogCalls(source: string): UnredactedLogCall[] {
  const offenders: UnredactedLogCall[] = [];
  LOG_CALL.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LOG_CALL.exec(source)) !== null) {
    const argsStart = match.index + match[0].length;
    const line = source.slice(0, match.index).split('\n').length;
    const level = match[1] ?? 'error';

    if (isWhollyRedacted(source, argsStart)) continue;

    // 细分违规原因，便于定位修复
    const trivia = skipTrivia(source, argsStart);
    const rest = source.slice(trivia);
    let reason: UnredactedLogCall['reason'] = 'args-not-wrapped';
    if (rest.startsWith(`${REDACT_FOR_LOG}(`)) {
      reason = 'concat-after-redaction';
      // 若是「redactForLog(x), y」形态（第二实参），reason 归为 extra-args
      const close = skipBalanced(source, trivia + REDACT_FOR_LOG.length, '(', ')');
      if (close !== -1) {
        const tail = skipTrivia(source, close + 1);
        if (source[tail] === ',') reason = 'extra-args';
      }
    }

    offenders.push({ line, level, reason });
  }
  return offenders;
}
