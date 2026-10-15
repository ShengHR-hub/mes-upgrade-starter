import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { toShanghaiDate } from '../../common/utils/datetime.util.js';
import { DailyReportsService } from './daily-reports.service.js';

describe('DailyReportsService (契约 §7.2 / F2 AI生产日报)', () => {
  const mockUser = {
    id: '1',
    role: 'admin',
    username: 'admin',
  } as any;

  it('日期校验：非真实日历日（如 2026-02-31）抛 10001 INVALID_ARGUMENT', async () => {
    const service = new DailyReportsService({} as any, {} as any, {} as any);
    await expect(
      service.generateDailyReport({ date: '2026-02-31' }, mockUser),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('日期校验：超过近 7 天窗口（如 30 天前或未来日期）抛 10001 INVALID_ARGUMENT', async () => {
    const service = new DailyReportsService({} as any, {} as any, {} as any);
    await expect(
      service.generateDailyReport({ date: '2020-01-01' }, mockUser),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('正常生成：四段结构完整，数量与比率原样透传，isTrueFpy 恒为 false', async () => {
    const today = toShanghaiDate();

    const mockMetricsService = {
      getProductionMetrics: vi.fn(async () => ({
        startDate: today,
        endDate: today,
        snapshotAt: '2026-10-09T09:00:00+08:00',
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
        ],
        dataSource: 'demo',
        dataLabel: '演示数据',
      })),
    };

    const mockDataSource = {
      query: vi.fn(async () => []), // 当日无预警
    };

    const mockAlertsService = {
      analyzeRootCauseForAlertRow: vi.fn(),
    };

    const mockAiProxy = {
      callDailyReports: vi.fn(async () => ({
        answerStatus: 'answered',
        overviewText: '演示数据：当日产出80件，其中良品76件；累计完成率76.00%。',
        linePerformance: [],
        alerts: [],
        suggestions: [],
        mode: 'local',
        degraded: false,
        usage: { tokensIn: 10, tokensOut: 20 },
        latencyMs: 15,
      })),
      logAiQuery: vi.fn(),
    };

    const service = new DailyReportsService(
      mockDataSource as any,
      mockMetricsService as any,
      mockAlertsService as any,
      mockAiProxy as any,
    );

    const report = await service.generateDailyReport({ date: today }, mockUser);

    expect(report.date).toBe(today);
    expect(report.answerStatus).toBe('answered');
    expect(report.overview).toMatchObject({
      planQty: 14,
      planTotalQty: 100,
      doneQty: 76,
      outputQty: 80,
      goodQty: 76,
      badQty: 4,
      completionRate: 76,
      goodRate: 95,
      isTrueFpy: false,
      text: '演示数据：当日产出80件，其中良品76件；累计完成率76.00%。',
    });
    expect(report.linePerformance).toHaveLength(1);
    expect(report.linePerformance[0].prodLine).toBe('SMT-3');
    expect(report.alerts).toEqual([]);
    expect(report.suggestions).toEqual([]);
    expect(report.dataSource).toBe('demo');
    expect(report.dataLabel).toBe('演示数据');
    expect(mockAiProxy.logAiQuery).toHaveBeenCalledTimes(1);
    expect(mockAiProxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'report',
        userId: '1',
        status: '成功',
      }),
    );
  });

  it('预警关联：建议严格通过 alertId 关联，无预警时两数组为空', async () => {
    const today = toShanghaiDate();

    const mockMetricsService = {
      getProductionMetrics: vi.fn(async () => ({
        startDate: today,
        endDate: today,
        snapshotAt: '2026-10-09T09:00:00+08:00',
        metrics: {
          planQty: 10,
          planTotalQty: 100,
          doneQty: 50,
          outputQty: 50,
          goodQty: 45,
          badQty: 5,
          completionRate: 50,
          goodRate: 90,
          isTrueFpy: false,
          calculationStatus: 'available',
        },
        lines: [],
        dataSource: 'demo',
        dataLabel: '演示数据',
      })),
    };

    const mockAlertRows = [
      {
        id: '801',
        level: '重要',
        type: '质量异常',
        title: 'SMT-3良品率低于97%',
        content: null,
        ref_type: null,
        ref_id: null,
        status: '未处理',
        created_at_epoch: 1791507600,
      },
      {
        id: '802',
        level: '重要',
        type: '延期风险',
        title: 'SMT-3累计完成率低于90%',
        content: null,
        ref_type: null,
        ref_id: null,
        status: '未处理',
        created_at_epoch: 1791507600,
      },
    ];

    const mockDataSource = {
      query: vi.fn(async () => mockAlertRows),
    };

    const mockAlertsService = {
      analyzeRootCauseForAlertRow: vi.fn(async (row) => {
        if (row.id === '801') {
          return {
            alertId: '801',
            possibleCauses: [],
            explanation: '无足够关联证据',
            suggestion: '请质检员复核该时段不良类型与检验记录。',
            analysisStatus: 'insufficient_evidence',
          };
        }
        return {
          alertId: '802',
          possibleCauses: [],
          explanation: '无足够关联证据',
          suggestion: '请计划员核对剩余工序计划。',
          analysisStatus: 'insufficient_evidence',
        };
      }),
    };

    const mockAiProxy = {
      callDailyReports: vi.fn(async (req) => ({
        answerStatus: 'answered',
        overviewText: '文本解读',
        linePerformance: [],
        alerts: req.alerts,
        suggestions: ['请质检员复核该时段不良类型与检验记录。', '请计划员核对剩余工序计划。'],
        mode: 'local',
        degraded: false,
        usage: { tokensIn: 5, tokensOut: 5 },
        latencyMs: 10,
      })),
      logAiQuery: vi.fn(),
    };

    const service = new DailyReportsService(
      mockDataSource as any,
      mockMetricsService as any,
      mockAlertsService as any,
      mockAiProxy as any,
    );

    const report = await service.generateDailyReport({ date: today }, mockUser);

    expect(report.alerts).toHaveLength(2);
    expect(report.alerts[0].alertId).toBe('801');
    expect(report.alerts[1].alertId).toBe('802');

    expect(report.suggestions).toEqual([
      { alertId: '801', text: '请质检员复核该时段不良类型与检验记录。' },
      { alertId: '802', text: '请计划员核对剩余工序计划。' },
    ]);
  });

  it('无业务数据：返回 answerStatus=no_data，不编造虚假数据', async () => {
    const today = toShanghaiDate();

    const mockMetricsService = {
      getProductionMetrics: vi.fn(async () => ({
        startDate: today,
        endDate: today,
        snapshotAt: '2026-10-09T09:00:00+08:00',
        metrics: {
          planQty: 0,
          planTotalQty: 0,
          doneQty: 0,
          outputQty: 0,
          goodQty: 0,
          badQty: 0,
          completionRate: null,
          goodRate: null,
          isTrueFpy: false,
          calculationStatus: 'no_data',
        },
        lines: [],
        dataSource: 'demo',
        dataLabel: '演示数据',
      })),
    };

    const mockDataSource = {
      query: vi.fn(async () => []),
    };

    const mockAiProxy = {
      callDailyReports: vi.fn(async () => ({
        answerStatus: 'no_data',
        overviewText: '演示数据：当日无可用生产数据（calculationStatus=no_data）。',
        linePerformance: [],
        alerts: [],
        suggestions: [],
        mode: 'local',
        degraded: false,
        usage: { tokensIn: 0, tokensOut: 0 },
        latencyMs: 5,
      })),
      logAiQuery: vi.fn(),
    };

    const service = new DailyReportsService(
      mockDataSource as any,
      mockMetricsService as any,
      {} as any,
      mockAiProxy as any,
    );

    const report = await service.generateDailyReport({ date: today }, mockUser);
    expect(report.answerStatus).toBe('no_data');
    expect(report.overview.completionRate).toBeNull();
    expect(report.overview.goodRate).toBeNull();
    expect(report.overview.text).toContain('无可用生产数据');
  });

  it('P2 整改：内部多次根因分析及日报请求的 token/latency 累加，若存在降级则状态为“降级”并标记 degraded: true', async () => {
    const today = toShanghaiDate();

    const mockMetricsService = {
      getProductionMetrics: vi.fn(async () => ({
        startDate: today,
        endDate: today,
        snapshotAt: '2026-10-09T09:00:00+08:00',
        metrics: {
          planQty: 20,
          planTotalQty: 100,
          doneQty: 60,
          outputQty: 60,
          goodQty: 55,
          badQty: 5,
          completionRate: 60,
          goodRate: 91.67,
          isTrueFpy: false,
          calculationStatus: 'available',
        },
        lines: [],
        dataSource: 'demo',
        dataLabel: '演示数据',
      })),
    };

    const mockAlertRows = [
      {
        id: '801',
        level: '重要',
        type: '质量异常',
        title: '不良偏高',
        content: null,
        ref_type: null,
        ref_id: null,
        status: '未处理',
        created_at_epoch: 1791507600,
      },
      {
        id: '802',
        level: '重要',
        type: '设备停机',
        title: '设备停机',
        content: null,
        ref_type: null,
        ref_id: null,
        status: '未处理',
        created_at_epoch: 1791507600,
      },
    ];

    const mockDataSource = {
      query: vi.fn(async () => mockAlertRows),
    };

    const mockAlertsService = {
      analyzeRootCauseForAlertRow: vi.fn(async (row) => {
        if (row.id === '801') {
          return {
            alertId: '801',
            possibleCauses: [],
            explanation: null,
            suggestion: '检查贴片机',
            analysisStatus: 'insufficient_evidence',
            tokensIn: 10,
            tokensOut: 15,
            latencyMs: 20,
            degraded: true, // 触发降级
          };
        }
        return {
          alertId: '802',
          possibleCauses: [],
          explanation: null,
          suggestion: '检查回流焊',
          analysisStatus: 'insufficient_evidence',
          tokensIn: 8,
          tokensOut: 12,
          latencyMs: 15,
          degraded: false,
        };
      }),
    };

    const mockAiProxy = {
      callDailyReports: vi.fn(async (req) => ({
        answerStatus: 'answered',
        overviewText: '汇总解读',
        linePerformance: [],
        alerts: req.alerts,
        suggestions: ['检查贴片机', '检查回流焊'],
        mode: 'local',
        degraded: false,
        usage: { tokensIn: 25, tokensOut: 50 },
        latencyMs: 40,
      })),
      logAiQuery: vi.fn(),
    };

    const service = new DailyReportsService(
      mockDataSource as any,
      mockMetricsService as any,
      mockAlertsService as any,
      mockAiProxy as any,
    );

    const report = await service.generateDailyReport({ date: today }, mockUser);

    expect(report.degraded).toBe(true);
    expect(mockAiProxy.logAiQuery).toHaveBeenCalledTimes(1);
    expect(mockAiProxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'report',
        userId: '1',
        tokensIn: 43, // 10 + 8 + 25
        tokensOut: 77, // 15 + 12 + 50
        latencyMs: 75, // 20 + 15 + 40
        status: '降级',
      }),
    );
  });

  it('P2 整改：下游 AI 代理调用失败时，记录 status: 失败 审计日志并向上抛出异常', async () => {
    const today = toShanghaiDate();

    const mockMetricsService = {
      getProductionMetrics: vi.fn(async () => ({
        startDate: today,
        endDate: today,
        snapshotAt: '2026-10-09T09:00:00+08:00',
        metrics: {
          planQty: 10,
          planTotalQty: 100,
          doneQty: 50,
          outputQty: 50,
          goodQty: 45,
          badQty: 5,
          completionRate: 50,
          goodRate: 90,
          isTrueFpy: false,
          calculationStatus: 'available',
        },
        lines: [],
        dataSource: 'demo',
        dataLabel: '演示数据',
      })),
    };

    const mockDataSource = {
      query: vi.fn(async () => []),
    };

    const mockAiProxy = {
      callDailyReports: vi.fn(async () => {
        throw new BusinessException(ErrorCode.DEPENDENCY_UNAVAILABLE, 'AI 服务异常');
      }),
      logAiQuery: vi.fn(),
    };

    const service = new DailyReportsService(
      mockDataSource as any,
      mockMetricsService as any,
      {} as any,
      mockAiProxy as any,
    );

    await expect(service.generateDailyReport({ date: today }, mockUser)).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    });

    expect(mockAiProxy.logAiQuery).toHaveBeenCalledTimes(1);
    expect(mockAiProxy.logAiQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'report',
        userId: '1',
        status: '失败',
      }),
    );
  });
});
