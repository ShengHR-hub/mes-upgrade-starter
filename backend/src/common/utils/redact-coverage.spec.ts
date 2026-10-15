import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findUnredactedLogCalls } from './log-redaction-guard.js';

/**
 * 日志脱敏覆盖守卫（审查 P1：「将所有原始异常日志入口统一经过脱敏」）。
 *
 * 仅靠"当前这几处改好了"不足以防回归 —— 后续新增一个 `this.logger.error(...)`
 * 就可能重新打开凭据泄露通道。本用例静态扫描 `src/**`，
 * 要求**每一个 `logger.error` / `logger.warn` 调用点**的实参都被 `redactForLog(` 整体包裹。
 *
 * ⚠️ 第四轮审查 P2 修复：旧判据是"调用点后 400 字符窗口内出现 redactForLog("，
 * 未脱敏调用后紧跟已脱敏调用时会被放行。现改为严格判据（见 log-redaction-guard.ts），
 * 并新增**必须失败**的反例用例锁定该行为。
 *
 * 只扫 `error` / `warn` 两个级别：`log` / `debug` 用于启动信息与请求行（不含异常文本），
 * 若将来在 `log`/`debug` 里输出异常，应一并纳入本守卫。
 */

const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url));

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) files.push(full);
  }
  return files;
}

describe('日志脱敏覆盖守卫', () => {
  /** 检查器模块自身：只含判定逻辑与**文档注释示例**，不含真实 logger 调用，予以豁免。
   *  豁免不是无条件放行 —— 下方断言保证该文件不得引入 Nest Logger，否则豁免即漏洞。 */
  const GUARD_MODULE = fileURLToPath(new URL('./log-redaction-guard.ts', import.meta.url));

  it('豁免的检查器模块不得引入 Nest Logger（防豁免被滥用）', () => {
    expect(readFileSync(GUARD_MODULE, 'utf8')).not.toMatch(/@nestjs\/common/);
  });

  it('每个 logger.error / logger.warn 调用点的实参都必须被 redactForLog 整体包裹', () => {
    const files = listTsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];

    for (const file of files) {
      if (file === GUARD_MODULE) continue; // 见上方豁免说明
      const source = readFileSync(file, 'utf8');
      for (const call of findUnredactedLogCalls(source)) {
        offenders.push(
          `${file.replace(SRC_DIR, 'src/').replace(/\\/g, '/')}:${call.line} logger.${call.level}`,
        );
      }
    }

    expect(offenders, `以下日志调用点未脱敏：\n${offenders.join('\n')}`).toEqual([]);
  });

  describe('判据反例（必须失败 —— 第四/五轮审查 P2 回归）', () => {
    it('未脱敏调用后紧跟已脱敏调用：前者必须被判违规（旧窗口判据会漏检）', () => {
      const source = [
        'function f() {',
        '  this.logger.error(`raw ${secret}`);        // ← 未脱敏',
        '  this.logger.warn(redactForLog(`safe`));     // ← 已脱敏',
        '}',
      ].join('\n');

      const offenders = findUnredactedLogCalls(source);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatchObject({ line: 2, level: 'error' });
    });

    it('完全未脱敏：判违规', () => {
      const offenders = findUnredactedLogCalls('this.logger.error(`boom ${e.message}`);');
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatchObject({ level: 'error' });
    });

    it('模板字符串里仅内插 redactForLog（部分脱敏）：同样判违规', () => {
      const offenders = findUnredactedLogCalls(
        'this.logger.warn(`a ${redactForLog(b)} c ${raw}`);',
      );
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatchObject({ level: 'warn' });
    });

    it('**脱敏结果上拼接原文**：判违规（第五轮审查 P2 反例）', () => {
      const offenders = findUnredactedLogCalls('logger.error(redactForLog(safe) + raw);');
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatchObject({ level: 'error', reason: 'concat-after-redaction' });
    });

    it('**第二个实参携带原始堆栈**：判违规（第五轮审查 P2 反例）', () => {
      const offenders = findUnredactedLogCalls('logger.error(redactForLog(safe), rawStack);');
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatchObject({ level: 'error', reason: 'extra-args' });
    });

    it('实参整体包裹（含跨行与尾随逗号）：不判违规', () => {
      const source = [
        'this.logger.error(',
        '  redactForLog(`multi ${line} template`),',
        ');',
        'logger.warn(redactForLog(x));',
        "logger.warn(redactForLog(`a ${b ? `x${c}` : 'd'} e`));", // 嵌套模板 + 字符串
      ].join('\n');
      expect(findUnredactedLogCalls(source)).toEqual([]);
    });
  });
});
