import { Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter.js';

/**
 * 回归背景（S5 审查 P1）：5xx 分支把异常 `message` 与堆栈原样写日志，
 * 异常里带口令 / 令牌 / 带凭据连接串时会以明文落到日志文件。
 *
 * 本用例直接驱动异常过滤器并捕获 `Logger.error` 的输出，
 * 同时断言**响应体**仍然是安全文案 —— 两条通道一起验。
 */
function makeHost(request: unknown): {
  host: ArgumentsHost;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, json }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

/** 捕获 5xx 日志通道的输出（只取首参，即格式化后的整条日志） */
function captureErrorLog(): { logged: string[]; restore: () => void } {
  const logged: string[] = [];
  const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(String(args[0]));
  });
  return { logged, restore: () => spy.mockRestore() };
}

const REQUEST = {
  method: 'POST',
  path: '/api/v1/orders',
  requestId: 'req-abc-123',
};

let captured: { logged: string[]; restore: () => void } | null = null;

afterEach(() => {
  captured?.restore();
  captured = null;
});

describe('AllExceptionsFilter —— 5xx 日志与响应双双脱敏', () => {
  it('日志不得出现凭据原文，但保留请求号 / 方法路径 / 状态码与错误码', () => {
    captured = captureErrorLog();
    const filter = new AllExceptionsFilter();
    const { host } = makeHost(REQUEST);

    filter.catch(
      new Error(
        'connect failed dsn=mysql://root:secret@127.0.0.1:3306/smart_mes password=hunter2 token=abcdefghijklmnop',
      ),
      host,
    );

    const logged = captured.logged.join('\n');
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('abcdefghijklmnop');
    // 排查所需信息必须保留
    expect(logged).toContain('req-abc-123');
    expect(logged).toContain('POST /api/v1/orders');
    expect(logged).toContain('500/50001');
    expect(logged).toContain('***');
  });

  it('堆栈里的凭据同样被脱敏', () => {
    captured = captureErrorLog();
    const filter = new AllExceptionsFilter();
    const { host } = makeHost(REQUEST);

    const exception = new Error('boom');
    exception.stack = [
      'Error: boom',
      '    at connect (file:///app/db.js:1:1)',
      '    at init (dsn=postgres://admin:topsecret@db:5432/mes)',
    ].join('\n');
    filter.catch(exception, host);

    const logged = captured.logged.join('\n');
    expect(logged).not.toContain('topsecret');
    expect(logged).toContain('postgres://***@db:5432/mes');
  });

  it('响应体仍为契约安全文案，且 data 置 null', () => {
    captured = captureErrorLog();
    const filter = new AllExceptionsFilter();
    const { host, json, status } = makeHost(REQUEST);

    filter.catch(new Error('password=hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: 50001, message: '服务器内部错误', data: null });
    expect(JSON.stringify(json.mock.calls)).not.toContain('hunter2');
  });

  it('**JSON 形式的凭据也必须脱敏**（审查 P1 回归：验证实际日志输出）', () => {
    captured = captureErrorLog();
    const filter = new AllExceptionsFilter();
    const { host } = makeHost(REQUEST);

    filter.catch(
      new Error(
        'upstream rejected: {"username":"admin","password":"hunter2","accessToken":"abcdefghijklmnop"}',
      ),
      host,
    );

    const logged = captured.logged.join('\n');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('abcdefghijklmnop');
    expect(logged).toContain('"password":***');
    expect(logged).toContain('"accessToken":***');
    // 非敏感内容保留，日志仍可用于排查
    expect(logged).toContain('"username":"admin"');
    expect(logged).toContain('req-abc-123');
  });

  it('未预期异常仍走 5xx 通道并记录一条日志', () => {
    captured = captureErrorLog();
    const filter = new AllExceptionsFilter();
    const { host, status } = makeHost(REQUEST);

    filter.catch(new Error('plain failure'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(captured.logged).toHaveLength(1);
  });
});
