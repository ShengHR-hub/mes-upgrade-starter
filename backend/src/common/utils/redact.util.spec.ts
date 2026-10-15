import { describe, expect, it } from 'vitest';

import { redactForLog } from './redact.util.js';

/**
 * 回归背景（S5 审查 P1）：5xx 分支把异常 `message` 与堆栈原样写日志，
 * 凭据类文本会以明文落到日志文件。
 * 下方第一条用例使用的正是既有故障用例（`test/app.e2e-spec.ts` 的 boom 探针）的原样载荷。
 */
describe('redactForLog —— 日志边界的凭据脱敏', () => {
  it('脱敏带凭据的连接串（既有故障用例的原样载荷）', () => {
    const raw =
      'Error: INTERNAL_MARKER_SHOULD_NOT_LEAK :: dsn=mysql://root:secret@127.0.0.1:3306/smart_mes\n    at boom';
    const safe = redactForLog(raw);

    expect(safe).not.toContain('secret');
    expect(safe).toContain('mysql://***@127.0.0.1:3306/smart_mes'); // 主机/库保留，便于排查
    expect(safe).toContain('INTERNAL_MARKER_SHOULD_NOT_LEAK'); // 非凭据文本不被改动
  });

  it('脱敏常见敏感键（含前后缀形式）', () => {
    const cases: Array<[string, string]> = [
      ['password=hunter2', 'hunter2'],
      ['DB_PASSWORD=p@ssw0rd', 'p@ssw0rd'],
      ['AI_API_KEY=sk-abcdef123456', 'sk-abcdef123456'],
      ['JWT_SECRET=supersecretvalue', 'supersecretvalue'],
      ['AI_SERVICE_TOKEN=tok_1234567890', 'tok_1234567890'],
      ['apiKey: "abcdef123456"', 'abcdef123456'],
      ['client_secret=abc123', 'abc123'],
    ];
    for (const [raw, secret] of cases) {
      const safe = redactForLog(raw);
      expect(safe, raw).not.toContain(secret);
      expect(safe, raw).toContain('***');
    }
  });

  it('**脱敏 JSON 形式的敏感键**（审查 P1 回归：键带引号时旧规则失配）', () => {
    const raw =
      'payload={"username":"admin","password":"hunter2","accessToken":"abcdefghijklmnop","refreshToken":"zzzzzzzzzzzz"}';
    const safe = redactForLog(raw);

    expect(safe).not.toContain('hunter2');
    expect(safe).not.toContain('abcdefghijklmnop');
    expect(safe).not.toContain('zzzzzzzzzzzz');
    expect(safe).toContain('"password":***');
    expect(safe).toContain('"accessToken":***');
    expect(safe).toContain('"refreshToken":***');
    // 非敏感字段必须保留（日志仍可用于排查）
    expect(safe).toContain('"username":"admin"');
  });

  it('JSON 键带空格与单引号形式同样脱敏', () => {
    expect(redactForLog('{"apiKey": "sk-abcdef123456"}')).not.toContain('sk-abcdef123456');
    expect(redactForLog("{'secret': 'topsecretvalue'}")).not.toContain('topsecretvalue');
    expect(redactForLog('{"db_password":"p@ss"}')).not.toContain('p@ss');
  });

  it('**JSON 值内含转义引号时不得截断泄露**（审查第四轮 P1 回归）', () => {
    // 值 `"ab\"SECRET-TAIL"` 内含 `\"`：旧规则 `"[^"]*"` 会在转义引号处提前收尾，
    // 只替换到 `ab\"`，后缀 SECRET-TAIL 原样进日志。
    const raw = 'Error: {"password":"ab\\"SECRET-TAIL","x":1}';
    const safe = redactForLog(raw);

    expect(safe, safe).not.toContain('SECRET-TAIL');
    expect(safe).toContain('"password":***');
    // 非敏感字段不受影响
    expect(safe).toContain('"x":1');
  });

  it('单引号值内含转义引号同样不泄露', () => {
    const raw = "db error: {'password':'it\\'s SECRET-TAIL'} tail";
    expect(redactForLog(raw)).not.toContain('SECRET-TAIL');
  });

  it('脱敏 Authorization 裸形态与 JWT', () => {
    const bearer = redactForLog('Authorization: Bearer abcdefghijklmnop');
    expect(bearer).not.toContain('abcdefghijklmnop');

    const jwt = redactForLog(
      'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqr',
    );
    expect(jwt).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(jwt).toContain('***');
  });

  it('保留排查所需的非敏感信息（请求号 / 分类 / 路径 / 堆栈行）', () => {
    const raw =
      '[3f1c9a2e-0000-4000-8000-000000000001] POST /api/v1/orders -> 500/50001 :: Error: boom\n    at OrdersService.create (orders.service.ts:194:11)';
    const safe = redactForLog(raw);

    expect(safe).toContain('3f1c9a2e-0000-4000-8000-000000000001');
    expect(safe).toContain('POST /api/v1/orders');
    expect(safe).toContain('500/50001');
    expect(safe).toContain('orders.service.ts:194:11');
  });

  it('普通文本不被误改', () => {
    const raw = 'ER_DUP_ENTRY: Duplicate entry WO-20261010-001 for key work_order.code';
    expect(redactForLog(raw)).toBe(raw);
  });

  it('非字符串输入也能安全处理', () => {
    expect(() => redactForLog(undefined)).not.toThrow();
    expect(redactForLog(undefined)).toBe('undefined');
    expect(redactForLog({ password: 'x' })).not.toContain("password: 'x'");
  });
});
