import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { addDaysDateOnly } from '../../common/utils/date-only.util.js';
import { toShanghaiDate } from '../../common/utils/datetime.util.js';
import { DataQueriesQueryExecutor } from './data-queries.query.js';
import { DataQueriesService } from './data-queries.service.js';

const TODAY = toShanghaiDate();
const MIN_ALLOWED = addDaysDateOnly(TODAY, -6);
const mockUser = { id: '1', role: 'admin', username: 'admin' } as any;

function makeMetricsMock(perDay?: Record<string, any>) {
  return {
    getProductionMetrics: vi.fn(async (query: any) => {
      if (perDay && query.startDate === query.endDate) {
        const day = perDay[query.startDate];
        if (day) return day(query.prodLine);
      }
      return {
        startDate: query.startDate,
        endDate: query.endDate,
        snapshotAt: '2026-10-13T09:00:00+08:00',
        metrics: {
          planQty: 14,
          planTotalQty: 100,
          doneQty: 76,
          outputQty: 80,
          goodQty: 76,
          badQty: 4,
          completionRate: 76,
          goodRate: 95,
          isTrueFpy: false,
          calculationStatus: 'available',
        },
        lines: [
          {
            prodLine: 'SMT-3',
            planQty: 14,
            planTotalQty: 100,
            doneQty: 76,
            outputQty: 80,
            goodQty: 76,
            badQty: 4,
            completionRate: 76,
            goodRate: 95,
          },
          {
            prodLine: 'SMT-1',
            planQty: 14,
            planTotalQty: 100,
            doneQty: 60,
            outputQty: 70,
            goodQty: 68,
            badQty: 2,
            completionRate: 60,
            goodRate: 97.14,
          },
        ],
        dataSource: 'demo',
        dataLabel: '演示数据',
      };
    }),
  };
}

function makeAiProxyMock(intent: any, answer?: any) {
  return {
    callQueryIntents: vi.fn(async () => ({
      supported: true,
      intent,
      usage: { tokensIn: 3, tokensOut: 4 },
      latencyMs: 12,
    })),
    callQueryAnswers:
      answer ??
      vi.fn(async () => ({
        answerStatus: 'answered',
        answer: '查询结果：产线 SMT-3 报工良品率 95%，为所查询范围最低。',
        mode: 'local',
        degraded: false,
        usage: { tokensIn: 5, tokensOut: 6 },
        latencyMs: 8,
      })),
    logAiQuery: vi.fn(),
  };
}

function makeExecutor(queryImpl?: (sql: string, params: unknown[]) => Promise<any[]>) {
  const defaultImpl = async (sql: string) =>
    sql.includes('UNION') ? [{ prod_line: 'SMT-2线' }] : [];
  return new DataQueriesQueryExecutor({
    query: vi.fn(queryImpl ?? defaultImpl),
  } as any);
}

const GOOD_RATE_MIN_INTENT = {
  metric: 'goodRate',
  groupBy: 'prodLine',
  startDate: TODAY,
  endDate: TODAY,
  prodLine: null,
  operation: 'minimum',
};

describe('DataQueriesService (契约 §7.1 / §4.1 F3)', () => {
  it('示例1：goodRate/prodLine/minimum 全链路，rows 来自受控查询，审计仅一条', async () => {
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      makeAiProxyMock(GOOD_RATE_MIN_INTENT) as any,
    );

    const res = await service.queryData({ question: '今天哪条产线直通率最低？' }, mockUser);

    expect(res.answerStatus).toBe('answered');
    expect(res.query).toEqual({ ...GOOD_RATE_MIN_INTENT });
    expect(res.columns.map((c) => c.key)).toEqual(['prodLine', 'goodRate']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      prodLine: 'SMT-3',
      goodRate: 95,
      dataStatus: 'available',
    });
    expect(res.sources[0]).toMatchObject({ resource: 'reports', filters: { finalTasksOnly: true } });
    expect(res.dataSource).toBe('demo');
    expect(res.dataLabel).toBe('演示数据');
    expect(res.degraded).toBe(false);

    const proxy = (service as any).aiProxy;
    expect(proxy.callQueryIntents).toHaveBeenCalledTimes(1);
    expect(proxy.callQueryAnswers).toHaveBeenCalledTimes(1);
    expect(proxy.logAiQuery).toHaveBeenCalledTimes(1);
    expect(proxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'nl_query',
        userId: '1',
        sqlGenerated: null,
        tokensIn: 8, // 3 + 5
        tokensOut: 10, // 4 + 6
        latencyMs: 20, // 12 + 8
        status: '成功',
      }),
    );
  });

  it('无报工的产线：goodRate 为 null + dataStatus=no_data，不改写为 0', async () => {
    const metricsMock = {
      getProductionMetrics: vi.fn(async () => ({
        metrics: { outputQty: 0, goodRate: null, goodQty: 0, badQty: 0 },
        lines: [{ prodLine: 'SMT-3', outputQty: 0, goodQty: 0, badQty: 0, goodRate: null }],
      })),
    };
    const service = new DataQueriesService(
      makeExecutor(),
      metricsMock as any,
      makeAiProxyMock(GOOD_RATE_MIN_INTENT) as any,
    );

    const res = await service.queryData({ question: '今天哪条产线直通率最低？' }, mockUser);
    expect(res.rows[0]).toMatchObject({ goodRate: null, dataStatus: 'no_data' });
  });

  it('意图不支持（supported:false）→ clarification_required，不执行任何查询', async () => {
    const proxy = {
      callQueryIntents: vi.fn(async () => ({
        supported: false,
        reason: '暂不支持按「车间」分组（groupBy 仅支持 prodLine/date/defectType/device）。',
        usage: { tokensIn: 0, tokensOut: 0 },
        latencyMs: 5,
      })),
      callQueryAnswers: vi.fn(),
      logAiQuery: vi.fn(),
    };
    const metricsMock = makeMetricsMock();
    const service = new DataQueriesService(makeExecutor(), metricsMock as any, proxy as any);

    const res = await service.queryData({ question: '按车间统计今天产量' }, mockUser);

    expect(res.answerStatus).toBe('clarification_required');
    expect(res.clarification).toContain('车间');
    expect(res.rows).toEqual([]);
    expect(proxy.callQueryAnswers).not.toHaveBeenCalled();
    expect(metricsMock.getProductionMetrics).not.toHaveBeenCalled();
    expect(proxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'nl_query', status: '成功' }),
    );
  });

  it('NestJS 白名单复核拒绝下游越界取值（不信赖 intent）', async () => {
    const proxy = {
      callQueryIntents: vi.fn(async () => ({
        supported: true,
        intent: { ...GOOD_RATE_MIN_INTENT, metric: 'oee' },
        usage: { tokensIn: 0, tokensOut: 0 },
        latencyMs: 5,
      })),
      callQueryAnswers: vi.fn(),
      logAiQuery: vi.fn(),
    };
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      proxy as any,
    );

    const res = await service.queryData({ question: '今天 OEE 多少' }, mockUser);
    expect(res.answerStatus).toBe('clarification_required');
    expect(res.clarification).toContain('白名单');
    expect(proxy.callQueryAnswers).not.toHaveBeenCalled();
  });

  it('显式日期与自然语言范围冲突 → 10001，并如实记录失败审计（保留已产生用量）', async () => {
    const proxy = makeAiProxyMock(GOOD_RATE_MIN_INTENT);
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      proxy as any,
    );

    await expect(
      service.queryData(
        { question: '今天哪条产线直通率最低？', startDate: MIN_ALLOWED, endDate: TODAY },
        mockUser,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });

    expect(proxy.callQueryAnswers).not.toHaveBeenCalled();
    expect(proxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'nl_query', status: '失败', tokensIn: 3 }),
    );
  });

  it('显式产线与自然语言冲突 → 10001', async () => {
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      makeAiProxyMock({ ...GOOD_RATE_MIN_INTENT, prodLine: 'SMT-2' }) as any,
    );

    await expect(
      service.queryData({ question: 'SMT-2 今天良品率', prodLine: 'SMT-1' }, mockUser),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('问题无日期词语时显式日期作为补充范围生效', async () => {
    const intent = {
      metric: 'goodQty',
      groupBy: 'prodLine',
      startDate: TODAY,
      endDate: TODAY,
      prodLine: null,
      operation: 'list',
    };
    const metricsMock = makeMetricsMock();
    const service = new DataQueriesService(
      makeExecutor(),
      metricsMock as any,
      makeAiProxyMock(intent) as any,
    );

    const res = await service.queryData(
      { question: '各产线良品数', startDate: MIN_ALLOWED, endDate: TODAY },
      mockUser,
    );
    // 显式范围被传递受控查询
    expect(metricsMock.getProductionMetrics).toHaveBeenCalledWith(
      { startDate: MIN_ALLOWED, endDate: TODAY, prodLine: undefined },
      expect.any(String),
    );
    expect(res.query).toMatchObject({ startDate: MIN_ALLOWED, endDate: TODAY });
  });

  it('问题含显式日期且与显式参数一致 → 放行并按该范围查询', async () => {
    const intent = {
      metric: 'goodQty',
      groupBy: 'prodLine',
      startDate: MIN_ALLOWED,
      endDate: TODAY,
      prodLine: null,
      operation: 'list',
    };
    const metricsMock = makeMetricsMock();
    const service = new DataQueriesService(
      makeExecutor(),
      metricsMock as any,
      makeAiProxyMock(intent) as any,
    );

    await service.queryData(
      { question: `近7天各产线良品数`, startDate: MIN_ALLOWED, endDate: TODAY },
      mockUser,
    );
    expect(metricsMock.getProductionMetrics).toHaveBeenCalledWith(
      { startDate: MIN_ALLOWED, endDate: TODAY, prodLine: undefined },
      expect.any(String),
    );
  });

  it('超出近 7 天窗口 → no_data 并解释缺失窗口，不执行查询', async () => {
    const intent = {
      metric: 'outputQty',
      groupBy: 'date',
      startDate: '2020-01-01',
      endDate: '2020-01-07',
      prodLine: null,
      operation: 'trend',
    };
    const metricsMock = makeMetricsMock();
    const service = new DataQueriesService(
      makeExecutor(),
      metricsMock as any,
      makeAiProxyMock(intent) as any,
    );

    const res = await service.queryData({ question: '2020-01-01 到 2020-01-07 产量趋势' }, mockUser);

    expect(res.answerStatus).toBe('no_data');
    expect(res.answer).toContain('近 7 天');
    expect(res.answer).toContain(MIN_ALLOWED);
    expect(metricsMock.getProductionMetrics).not.toHaveBeenCalled();
  });

  it('7 天完成率趋势：逐日升序，rows 含 doneQty/planTotalQty/completionRate/planQty', async () => {
    const start = MIN_ALLOWED;
    const perDay: Record<string, any> = {};
    for (let i = 0; i < 7; i++) {
      const day = addDaysDateOnly(start, i);
      perDay[day] = () => ({
        metrics: {
          planQty: 14,
          planTotalQty: 100,
          doneQty: 10 * (i + 1),
          outputQty: 10,
          goodQty: 9,
          badQty: 1,
          completionRate: 10 * (i + 1),
          goodRate: 90,
          calculationStatus: 'available',
        },
        lines: [],
      });
    }
    const intent = {
      metric: 'completionRate',
      groupBy: 'date',
      startDate: start,
      endDate: TODAY,
      prodLine: 'SMT-2',
      operation: 'trend',
    };
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock(perDay) as any,
      makeAiProxyMock(intent) as any,
    );

    const res = await service.queryData(
      { question: 'SMT-2 线这周完成率趋势怎么样？' },
      mockUser,
    );

    expect(res.rows).toHaveLength(7);
    expect(res.rows[0].date).toBe(start);
    expect(res.rows[6].date).toBe(TODAY);
    expect(res.columns.map((c) => c.key)).toEqual([
      'date',
      'planQty',
      'doneQty',
      'planTotalQty',
      'completionRate',
    ]);
    expect(res.rows[0]).toMatchObject({
      planQty: 14,
      doneQty: 10,
      planTotalQty: 100,
      completionRate: 10,
      dataStatus: 'available',
    });
  });

  it('完成率趋势遇计划数据不完整 → no_data + insufficient 说明，不猜日计划', async () => {
    const perDay: Record<string, any> = {};
    for (let i = 0; i < 7; i++) {
      const day = addDaysDateOnly(MIN_ALLOWED, i);
      perDay[day] = () => ({
        metrics: {
          planQty: 0,
          planTotalQty: 0,
          doneQty: 0,
          outputQty: 0,
          goodQty: 0,
          badQty: 0,
          completionRate: null,
          goodRate: null,
          calculationStatus: i === 2 ? 'insufficient_data' : 'available',
        },
        lines: [],
      });
    }
    const intent = {
      metric: 'completionRate',
      groupBy: 'date',
      startDate: MIN_ALLOWED,
      endDate: TODAY,
      prodLine: null,
      operation: 'trend',
    };
    const proxy = makeAiProxyMock(intent);
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock(perDay) as any,
      proxy as any,
    );

    const res = await service.queryData({ question: '这周完成率趋势' }, mockUser);
    expect(res.answerStatus).toBe('no_data');
    expect(res.answer).toContain('insufficient_data');
    expect(proxy.callQueryAnswers).not.toHaveBeenCalled();
  });

  it('不良类型聚合：defectQty/defectType/list，按别名解析后的实际名称 IN 过滤', async () => {
    const intent = {
      metric: 'defectQty',
      groupBy: 'defectType',
      startDate: TODAY,
      endDate: TODAY,
      prodLine: 'CAL-1',
      operation: 'list',
    };
    const querySpy = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('UNION')) {
        // 别名解析：CAL-1 → CAL-1线
        return [{ prod_line: 'CAL-1线' }];
      }
      expect(sql).toContain('GROUP BY');
      expect(sql).toContain('t.prod_line IN (?)');
      expect(params).toEqual([
        `${TODAY} 00:00:00`,
        `${addDaysDateOnly(TODAY, 1)} 00:00:00`,
        'CAL-1线',
      ]);
      return [
        { group_key: '虚焊', qty: 6 },
        { group_key: '错件', qty: 2 },
      ];
    });
    const service = new DataQueriesService(
      makeExecutor(querySpy),
      makeMetricsMock() as any,
      makeAiProxyMock(intent) as any,
    );

    const res = await service.queryData(
      { question: 'CAL-1 线的主要不良原因是什么？' },
      mockUser,
    );

    expect(res.rows).toEqual([
      { defectType: '虚焊', defectQty: 6, dataStatus: 'available' },
      { defectType: '错件', defectQty: 2, dataStatus: 'available' },
    ]);
    expect(res.columns.map((c) => c.key)).toEqual(['defectType', 'defectQty']);
    expect(res.sources[0]).toMatchObject({ resource: 'defects' });
  });

  it('设备状态：deviceStatus/device/list，字符串指标可转述', async () => {
    const intent = {
      metric: 'deviceStatus',
      groupBy: 'device',
      startDate: TODAY,
      endDate: TODAY,
      prodLine: null,
      operation: 'list',
    };
    const service = new DataQueriesService(
      makeExecutor(async () => [
        { code: 'EQP-SMT-006', name: '回流焊炉', prod_line: 'SMT-3', status: '维修中' },
        { code: 'EQP-SMT-001', name: '贴片机', prod_line: 'SMT-1', status: '运行中' },
      ]),
      makeMetricsMock() as any,
      makeAiProxyMock(intent) as any,
    );

    const res = await service.queryData({ question: '现在各台设备状态怎么样' }, mockUser);
    expect(res.rows[0]).toMatchObject({
      device: 'EQP-SMT-006',
      deviceStatus: '维修中',
    });
    expect(res.columns.map((c) => c.key)).toEqual([
      'device',
      'deviceName',
      'prodLine',
      'deviceStatus',
    ]);
  });

  it('降级：回答生成 degraded=true → 审计 status=降级 且 usage 完整保留', async () => {
    const answerMock = vi.fn(async () => ({
      answerStatus: 'answered',
      answer: '查询结果：产线 SMT-3 报工良品率 95%。',
      mode: 'local',
      degraded: true,
      usage: { tokensIn: 7, tokensOut: 9 },
      latencyMs: 6,
    }));
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      makeAiProxyMock(GOOD_RATE_MIN_INTENT, answerMock) as any,
    );

    const res = await service.queryData({ question: '今天哪条产线直通率最低？' }, mockUser);
    expect(res.degraded).toBe(true);

    const proxy = (service as any).aiProxy;
    expect(proxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        status: '降级',
        tokensIn: 10, // 3 + 7（模型用量即使输出被降级也保留）
        tokensOut: 13, // 4 + 9
        latencyMs: 18,
      }),
    );
  });

  it('下游回答生成失败 → 审计 status=失败 并向上抛错（不伪造成功）', async () => {
    const answerMock = vi.fn(async () => {
      throw Object.assign(new Error('AI 服务不可用'), {
        code: ErrorCode.DEPENDENCY_UNAVAILABLE,
      });
    });
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      makeAiProxyMock(GOOD_RATE_MIN_INTENT, answerMock) as any,
    );

    await expect(
      service.queryData({ question: '今天哪条产线直通率最低？' }, mockUser),
    ).rejects.toMatchObject({ code: ErrorCode.DEPENDENCY_UNAVAILABLE });

    const proxy = (service as any).aiProxy;
    expect(proxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'nl_query', status: '失败', tokensIn: 3 }),
    );
  });

  it('空问题 / 半对参数 → 10001，不触发任何 AI 调用', async () => {
    const proxy = makeAiProxyMock(GOOD_RATE_MIN_INTENT);
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      proxy as any,
    );

    await expect(service.queryData({ question: '   ' }, mockUser)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
    await expect(
      service.queryData({ question: '今天产量', startDate: TODAY }, mockUser),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(proxy.callQueryIntents).not.toHaveBeenCalled();
    expect(proxy.logAiQuery).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- S9 审查 P2 修复

  it('P2-1：数据库无匹配产线名称 → no_data 且说明产线未命中，不扩大为全厂', async () => {
    // 别名解析只返回 SMT-1线，查询意图是 SMT-2 → 无匹配
    const executor = {
      execute: vi.fn(async () => ({
        columns: [],
        rows: [],
        sources: [],
        planInsufficientReason: null,
        unknownProdLineReason:
          '产线「SMT-2」在现有数据中不存在对应记录（含常见别名），未查询任何数据；不扩大为全厂查询。',
      })),
    };
    const metricsMock = makeMetricsMock();
    const proxy = makeAiProxyMock({ ...GOOD_RATE_MIN_INTENT, prodLine: 'SMT-2' });
    const service = new DataQueriesService(
      executor as any,
      metricsMock as any,
      proxy as any,
    );

    const res = await service.queryData(
      { question: '今天 SMT-2 线良品率' },
      mockUser,
    );

    expect(res.answerStatus).toBe('no_data');
    expect(res.answer).toContain('不存在对应记录');
    expect(res.answer).toContain('不扩大为全厂查询');
    expect(metricsMock.getProductionMetrics).not.toHaveBeenCalled();
    expect(proxy.callQueryAnswers).not.toHaveBeenCalled();
  });

  it('P2-1（端到端）：SMT-2 经别名解析为 SMT-2线 进入受控查询', async () => {
    const queryMock = vi.fn(async (sql: string) =>
      sql.includes('UNION') ? [{ prod_line: 'SMT-1线' }, { prod_line: 'SMT-2线' }] : [],
    );
    const executor = new DataQueriesQueryExecutor({ query: queryMock } as any);
    const metricsMock = makeMetricsMock();
    const proxy = makeAiProxyMock({ ...GOOD_RATE_MIN_INTENT, prodLine: 'SMT-2' });
    const service = new DataQueriesService(executor, metricsMock as any, proxy as any);

    await service.queryData({ question: '今天 SMT-2 线良品率' }, mockUser);

    expect(metricsMock.getProductionMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ prodLines: ['SMT-2线'] }),
      expect.any(String),
    );
    expect(queryMock.mock.calls[0][0]).toContain('UNION');
  });

  it('P2-3：历史设备状态查询 → clarification_required，仅说明支持当前快照', async () => {
    const yesterday = addDaysDateOnly(TODAY, -1);
    const executor = {
      execute: vi.fn(),
    };
    const proxy = makeAiProxyMock({
      metric: 'deviceStatus',
      groupBy: 'device',
      startDate: yesterday,
      endDate: yesterday,
      prodLine: null,
      operation: 'list',
    });
    const service = new DataQueriesService(
      executor as any,
      makeMetricsMock() as any,
      proxy as any,
    );

    const res = await service.queryData({ question: '昨天设备状态有哪些' }, mockUser);

    expect(res.answerStatus).toBe('clarification_required');
    expect(res.clarification).toContain('当前快照');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(proxy.callQueryAnswers).not.toHaveBeenCalled();
    expect(proxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'nl_query', status: '成功' }),
    );
  });

  it('P2-3：当天设备状态查询正常放行', async () => {
    const executor = {
      execute: vi.fn(async () => ({
        columns: [
          { key: 'device', label: '设备', type: 'string' },
          { key: 'deviceStatus', label: '设备状态', type: 'string' },
        ],
        rows: [{ device: 'EQP-SMT-006', deviceStatus: '维修中', dataStatus: 'available' }],
        sources: [{ resource: 'devices', filters: {} }],
        planInsufficientReason: null,
        unknownProdLineReason: null,
      })),
    };
    const proxy = makeAiProxyMock({
      metric: 'deviceStatus',
      groupBy: 'device',
      startDate: TODAY,
      endDate: TODAY,
      prodLine: null,
      operation: 'list',
    });
    const service = new DataQueriesService(
      executor as any,
      makeMetricsMock() as any,
      proxy as any,
    );

    const res = await service.queryData({ question: '现在各台设备状态怎么样' }, mockUser);
    expect(res.answerStatus).toBe('answered');
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('P2-4：白名单复核拒绝执行器未实现的分组（outputQty/device/list）', async () => {
    const executor = { execute: vi.fn() };
    const proxy = makeAiProxyMock({
      metric: 'outputQty',
      groupBy: 'device',
      startDate: TODAY,
      endDate: TODAY,
      prodLine: null,
      operation: 'list',
    });
    const service = new DataQueriesService(
      executor as any,
      makeMetricsMock() as any,
      proxy as any,
    );

    const res = await service.queryData({ question: '按设备列出今天产量' }, mockUser);
    expect(res.answerStatus).toBe('clarification_required');
    expect(res.clarification).toContain('不支持的组合');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('P2-5：prodLine/startDate/endDate 传 null → 10001（不进入 null.trim 500 路径）', async () => {
    const proxy = makeAiProxyMock(GOOD_RATE_MIN_INTENT);
    const service = new DataQueriesService(
      makeExecutor(),
      makeMetricsMock() as any,
      proxy as any,
    );

    await expect(
      service.queryData({ question: '今天产量', prodLine: null as any }, mockUser),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    await expect(
      service.queryData({ question: '今天产量', startDate: null as any }, mockUser),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    await expect(
      service.queryData({ question: '今天产量', endDate: null as any }, mockUser),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(proxy.callQueryIntents).not.toHaveBeenCalled();
  });
});
