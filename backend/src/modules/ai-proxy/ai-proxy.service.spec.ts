import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { AiProxyService } from './ai-proxy.service.js';

describe('AiProxyService (F2/F4 内部通信与运行时结构校验)', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const mockConfig = {
    get: vi.fn((key: string) => {
      if (key === 'AI_SERVICE_URL') return 'http://127.0.0.1:8000';
      if (key === 'AI_SERVICE_TOKEN') return 'test-token';
      return undefined;
    }),
  };

  const mockDataSource = {
    query: vi.fn(),
  };

  it('P3 整改：响应体读取期间发生 AbortError，必须映射为 50003 DEPENDENCY_TIMEOUT', async () => {
    const service = new AiProxyService(mockConfig as any, mockDataSource as any);

    // Mock fetch 返回一个正常的 200 Response，但 response.json() 抛出 AbortError
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      },
    })) as any;

    await expect(
      service.callRootCauseAnalyses({
        alert: { type: '质量异常' },
        evidence: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-1',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_TIMEOUT,
    });
  });

  it('P2 整改：根因分析嵌套校验拒绝非法原因文本、字符串引用与非法状态', async () => {
    const service = new AiProxyService(mockConfig as any, mockDataSource as any);

    // 1. text 为数字类型
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          possibleCauses: [{ text: 12345, evidenceRefs: [] }],
          analysisStatus: 'hypothesis',
          mode: 'local',
          degraded: false,
        },
      }),
    })) as any;

    await expect(
      service.callRootCauseAnalyses({
        alert: { type: '质量异常' },
        evidence: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-2',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    // 2. evidenceRefs 为字符串而非数组
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          possibleCauses: [{ text: '有效文本', evidenceRefs: 'device:123' }],
          analysisStatus: 'hypothesis',
          mode: 'local',
          degraded: false,
        },
      }),
    })) as any;

    await expect(
      service.callRootCauseAnalyses({
        alert: { type: '质量异常' },
        evidence: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-3',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    // 3. analysisStatus 为未知状态
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          possibleCauses: [{ text: '有效文本', evidenceRefs: ['device:123'] }],
          analysisStatus: 'illegal_status',
          mode: 'local',
          degraded: false,
        },
      }),
    })) as any;

    await expect(
      service.callRootCauseAnalyses({
        alert: { type: '质量异常' },
        evidence: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-4',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    // 4. degraded 为非布尔值
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          possibleCauses: [],
          analysisStatus: 'insufficient_evidence',
          mode: 'local',
          degraded: 'false', // 字符串而非布尔值
        },
      }),
    })) as any;

    await expect(
      service.callRootCauseAnalyses({
        alert: { type: '质量异常' },
        evidence: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-5',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    // 5. usage 含有负数 tokensIn
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          possibleCauses: [],
          analysisStatus: 'insufficient_evidence',
          mode: 'local',
          degraded: false,
          usage: { tokensIn: -10, tokensOut: 0 },
        },
      }),
    })) as any;

    await expect(
      service.callRootCauseAnalyses({
        alert: { type: '质量异常' },
        evidence: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-6',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });
  });

  it('P2 整改：日报响应嵌套校验拒绝非法 answerStatus、负数用量与非法结构', async () => {
    const service = new AiProxyService(mockConfig as any, mockDataSource as any);

    // 1. answerStatus 非法枚举
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          answerStatus: 'unknown',
          overview: {},
          overviewText: '综述',
          linePerformance: [],
          alerts: [],
          suggestions: [],
          mode: 'local',
          degraded: false,
        },
      }),
    })) as any;

    await expect(
      service.callDailyReports({
        date: '2026-10-12',
        metrics: {},
        alerts: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-7',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    // 2. tokensOut 为负数
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          answerStatus: 'answered',
          overview: {},
          overviewText: '综述',
          linePerformance: [],
          alerts: [],
          suggestions: [],
          mode: 'local',
          degraded: false,
          usage: { tokensIn: 10, tokensOut: -5 },
        },
      }),
    })) as any;

    await expect(
      service.callDailyReports({
        date: '2026-10-12',
        metrics: {},
        alerts: [],
        snapshotAt: '2026-10-12T09:00:00+08:00',
        userContext: { userId: '1', role: 'admin' },
        requestId: 'req-8',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });
  });
});

describe('AiProxyService (S9 F3 query-intents / query-answers)', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const mockConfig = {
    get: vi.fn((key: string) => {
      if (key === 'AI_SERVICE_URL') return 'http://127.0.0.1:8000';
      if (key === 'AI_SERVICE_TOKEN') return 'test-token';
      return undefined;
    }),
  };

  const mockDataSource = { query: vi.fn() };

  const intentRequest = {
    question: '今天哪条产线直通率最低？',
    dateContext: { today: '2026-10-13', timeZone: 'Asia/Shanghai' },
    userContext: { userId: '1', role: 'admin' },
    requestId: 'req-qi-1',
  };

  const answerRequest = {
    question: '今天哪条产线直通率最低？',
    queryResult: {
      query: { metric: 'goodRate', startDate: '2026-10-13', endDate: '2026-10-13', prodLine: null },
      columns: [
        { key: 'prodLine', label: '产线', type: 'string' },
        { key: 'goodRate', label: '报工良品率', type: 'number', unit: '%' },
      ],
      rows: [{ prodLine: 'SMT-3', goodRate: 95 }],
      sources: [{ resource: 'reports', filters: { startDate: '2026-10-13', endDate: '2026-10-13' } }],
    },
    userContext: { userId: '1', role: 'admin' },
    requestId: 'req-qa-1',
  };

  it('意图解析：调用内部路径并返回结构化 intent', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          supported: true,
          intent: {
            metric: 'goodRate',
            groupBy: 'prodLine',
            startDate: '2026-10-13',
            endDate: '2026-10-13',
            prodLine: null,
            operation: 'minimum',
          },
          usage: { tokensIn: 0, tokensOut: 0 },
          latencyMs: 20,
        },
      }),
    }));
    global.fetch = fetchMock as any;

    const service = new AiProxyService(mockConfig as any, mockDataSource as any);
    const res = await service.callQueryIntents(intentRequest);

    expect(res.intent).toEqual({
      metric: 'goodRate',
      groupBy: 'prodLine',
      startDate: '2026-10-13',
      endDate: '2026-10-13',
      prodLine: null,
      operation: 'minimum',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/ai/query-intents',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('意图解析：supported=false 且缺 reason 时也允许（由 NestJS 生成澄清文案）', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: { supported: false, usage: { tokensIn: 0, tokensOut: 0 }, latencyMs: 5 },
      }),
    })) as any;

    const service = new AiProxyService(mockConfig as any, mockDataSource as any);
    const res = await service.callQueryIntents(intentRequest);
    expect(res.supported).toBe(false);
    expect(res.intent).toBeUndefined();
  });

  it('意图解析：supported=true 但 intent 缺失/日期非法 → 拒绝（DEPENDENCY_UNAVAILABLE）', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: { supported: true, usage: { tokensIn: 0, tokensOut: 0 }, latencyMs: 5 },
      }),
    })) as any;

    const service = new AiProxyService(mockConfig as any, mockDataSource as any);
    await expect(service.callQueryIntents(intentRequest)).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    // 日期格式非法（代理层只校验 YYYY-MM-DD 形状；日历真实性由 NestJS 白名单复核）
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          supported: true,
          intent: {
            metric: 'goodRate',
            groupBy: 'prodLine',
            startDate: '20261013',
            endDate: '2026-10-13',
            prodLine: null,
            operation: 'minimum',
          },
          usage: { tokensIn: 0, tokensOut: 0 },
          latencyMs: 5,
        },
      }),
    })) as any;

    await expect(service.callQueryIntents(intentRequest)).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });
  });

  it('回答生成：正常返回 answerStatus/answer/mode/degraded 与用量', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          answerStatus: 'answered',
          answer: '查询结果：产线 SMT-3 报工良品率 95%，为所查询范围最低。',
          mode: 'local',
          degraded: false,
          usage: { tokensIn: 2, tokensOut: 3 },
          latencyMs: 7,
        },
      }),
    })) as any;

    const service = new AiProxyService(mockConfig as any, mockDataSource as any);
    const res = await service.callQueryAnswers(answerRequest);
    expect(res.answerStatus).toBe('answered');
    expect(res.mode).toBe('local');
    expect(res.usage).toEqual({ tokensIn: 2, tokensOut: 3 });
  });

  it('回答生成：非法 answerStatus / 空白 answer / 非布尔 degraded → 拒绝', async () => {
    const service = new AiProxyService(mockConfig as any, mockDataSource as any);

    const badPayloads = [
      { answerStatus: 'unknown', answer: 'x', mode: 'local', degraded: false },
      { answerStatus: 'answered', answer: '   ', mode: 'local', degraded: false },
      { answerStatus: 'answered', answer: 'x', mode: 'local', degraded: 'true' },
      { answerStatus: 'answered', answer: 'x', mode: 'magic', degraded: false },
    ];

    for (const data of badPayloads) {
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ code: 0, message: 'ok', data }),
      })) as any;
      await expect(service.callQueryAnswers(answerRequest)).rejects.toMatchObject({
        code: ErrorCode.DEPENDENCY_UNAVAILABLE,
      });
    }
  });
});
