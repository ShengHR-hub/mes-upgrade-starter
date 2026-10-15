import crypto from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import {
  compareDateOnly,
  isValidDateOnly,
  nextDayDateOnly,
} from '../../common/utils/date-only.util.js';
import {
  toShanghaiDate,
  toShanghaiRfc3339,
} from '../../common/utils/datetime.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';
import { AiProxyService } from '../ai-proxy/ai-proxy.service.js';
import type {
  InternalDailyReportRequest,
  UserContextDto,
} from '../ai-proxy/ai-proxy.types.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { MetricsAggregationService } from '../dashboards/metrics-aggregation.service.js';

import type { GenerateDailyReportDto } from './dto/generate-daily-report.dto.js';
import type {
  DailyReportAlertItem,
  DailyReportResponse,
  DailyReportSuggestionItem,
} from './dto/daily-report-response.dto.js';

function shiftDateOnly(dateStr: string, offsetDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * AI 生产日报服务（F2 / 契约 §7.2）。
 *
 * 核心边界（§五）：
 * 1. 按需生成工厂级日报，仅支持契约约定的近 7 天（Asia/Shanghai 时区）；
 * 2. 复用 S7 MetricsAggregationService，四段固定（overview / linePerformance / alerts / suggestions）；
 * 3. 权威指标原样透传，报工良品率不等同真实 FPY，明确标注演示数据；
 * 4. 日报预警与建议复用 F4 同一结构化结果，suggestions 严格通过 alertId 关联，无预警时两数组为空；
 * 5. 每次外部请求写一次 ai_query_log，合并统计 tokens/latency，不重复记录；
 * 6. 仅 admin 可访问，服务端严格拦截。
 */
@Injectable()
export class DailyReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly metricsService: MetricsAggregationService,
    private readonly alertsService: AlertsService,
    @Optional() private readonly aiProxy?: AiProxyService,
  ) {}

  /**
   * 校验日期并确保属于近 7 天窗口
   */
  validateReportDate(date: string): void {
    if (!isValidDateOnly(date)) {
      throw invalidArgument({
        field: 'date',
        reason: 'date 必须为真实有效的 YYYY-MM-DD 日历日期',
      });
    }

    const todayShanghai = toShanghaiDate();
    const minAllowedDate = shiftDateOnly(todayShanghai, -6);
    const maxAllowedDate = todayShanghai;

    if (
      compareDateOnly(date, minAllowedDate) < 0 ||
      compareDateOnly(date, maxAllowedDate) > 0
    ) {
      throw invalidArgument({
        field: 'date',
        reason: `仅支持查询近 7 天工厂级日报（允许日期窗口：${minAllowedDate} 至 ${maxAllowedDate}）`,
      });
    }
  }

  /**
   * 生成生产日报（POST /api/v1/daily-reports）
   */
  async generateDailyReport(
    dto: GenerateDailyReportDto,
    user: AuthenticatedUser,
  ): Promise<DailyReportResponse> {
    const { date } = dto;
    this.validateReportDate(date);

    const snapshotAt = toShanghaiRfc3339();
    const userContext: UserContextDto = {
      userId: String(user.id),
      role: user.role,
    };

    // 1. 获取权威指标快照（S7 聚合口径）
    const metricsRes = await this.metricsService.getProductionMetrics(
      { startDate: date, endDate: date },
      snapshotAt,
    );

    // 2. 查询当日已持久化预警
    const nextDay = nextDayDateOnly(date);
    const alertRows = (await this.dataSource.query(
      `
      SELECT
        a.id,
        a.level,
        a.type,
        a.title,
        a.content,
        a.ref_type,
        a.ref_id,
        a.status,
        UNIX_TIMESTAMP(a.created_at) AS created_at_epoch
      FROM alert a
      WHERE a.created_at >= ? AND a.created_at < ?
      ORDER BY a.id ASC
    `,
      [`${date} 00:00:00`, `${nextDay} 00:00:00`],
    )) as any[];

    // 3. 对当日预警执行受控根因分析（复用 F4 结构）
    const analyzedAlerts: DailyReportAlertItem[] = [];
    const suggestions: DailyReportSuggestionItem[] = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalLatencyMs = 0;
    let anyDegraded = false;

    try {
      for (const row of alertRows) {
        const analysis = await this.alertsService.analyzeRootCauseForAlertRow(
          row,
          userContext,
          snapshotAt,
          true, // 不独立记日志，随日报合并写一次
        );

        totalTokensIn += analysis.tokensIn ?? 0;
        totalTokensOut += analysis.tokensOut ?? 0;
        totalLatencyMs += analysis.latencyMs ?? 0;
        if (analysis.degraded) {
          anyDegraded = true;
        }

        analyzedAlerts.push({
          alertId: analysis.alertId,
          type: String(row.type),
          title: String(row.title),
          possibleCauses: analysis.possibleCauses,
          explanation: analysis.explanation,
          suggestion: analysis.suggestion,
          analysisStatus: analysis.analysisStatus,
        });

        if (analysis.suggestion) {
          suggestions.push({
            alertId: analysis.alertId,
            text: analysis.suggestion,
          });
        }
      }

      // 4. 调用 FastAPI 进行四段式文本润色与组装
      let overviewText = '';
      let answerStatus: 'answered' | 'no_data' = 'answered';
      let mode = 'local';

      const isNoData =
        metricsRes.metrics.calculationStatus === 'no_data' ||
        (metricsRes.metrics.outputQty === 0 &&
          metricsRes.metrics.doneQty === 0 &&
          metricsRes.metrics.goodQty === 0 &&
          metricsRes.metrics.badQty === 0);

      if (this.aiProxy) {
        const requestId = crypto.randomUUID();
        const internalReq: InternalDailyReportRequest = {
          date,
          metrics: {
            startDate: metricsRes.startDate,
            endDate: metricsRes.endDate,
            snapshotAt: metricsRes.snapshotAt,
            metrics: metricsRes.metrics,
            lines: metricsRes.lines,
            dataSource: metricsRes.dataSource,
            dataLabel: metricsRes.dataLabel,
          },
          alerts: analyzedAlerts.map((a, idx) => ({
            id: a.alertId,
            alertId: a.alertId,
            type: a.type,
            level: alertRows[idx]?.level || '重要',
            title: a.title,
            content: alertRows[idx]?.content || null,
            refType: alertRows[idx]?.ref_type || null,
            refId: alertRows[idx]?.ref_id || null,
            status: alertRows[idx]?.status || '未处理',
            dataSource: 'demo',
            dataLabel: '演示数据',
            possibleCauses: a.possibleCauses,
            explanation: a.explanation,
            suggestion: a.suggestion,
            analysisStatus: a.analysisStatus,
          })),
          snapshotAt,
          userContext,
          requestId,
        };

        const aiRes = await this.aiProxy.callDailyReports(internalReq);
        overviewText = aiRes.overviewText;
        answerStatus = aiRes.answerStatus;
        mode = aiRes.mode;
        if (aiRes.degraded) {
          anyDegraded = true;
        }
        totalTokensIn += aiRes.usage?.tokensIn ?? 0;
        totalTokensOut += aiRes.usage?.tokensOut ?? 0;
        totalLatencyMs += aiRes.latencyMs ?? 0;
      } else {
        // 替身/本地回退默认文案
        answerStatus = isNoData ? 'no_data' : 'answered';
        if (answerStatus === 'no_data') {
          overviewText = `演示数据：当日无可用生产数据（calculationStatus=${metricsRes.metrics.calculationStatus}）。`;
        } else {
          const rateStr =
            metricsRes.metrics.completionRate !== null
              ? `${metricsRes.metrics.completionRate.toFixed(2)}%`
              : '无数据';
          const goodRateStr =
            metricsRes.metrics.goodRate !== null
              ? `${metricsRes.metrics.goodRate.toFixed(2)}%`
              : '无数据';
          overviewText =
            `演示数据：当日产出${metricsRes.metrics.outputQty}件，其中良品${metricsRes.metrics.goodQty}件；` +
            `累计良品${metricsRes.metrics.doneQty}件，计划总数${metricsRes.metrics.planTotalQty}件，` +
            `累计完成率${rateStr}，报工良品率${goodRateStr}。`;
        }
        mode = 'local';
      }

      // 5. 记录 AI 问答日志（写 ai_query_log：汇总全部内部调用用量、耗时及状态）
      if (this.aiProxy) {
        await this.aiProxy.logAiQuery({
          userId: userContext.userId,
          kind: 'report',
          question: `生产日报:${date}`,
          answer: overviewText,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          latencyMs: totalLatencyMs,
          status: anyDegraded ? '降级' : '成功',
        });
      }

      return {
        date,
        answerStatus,
        overview: {
          planQty: metricsRes.metrics.planQty,
          planTotalQty: metricsRes.metrics.planTotalQty,
          doneQty: metricsRes.metrics.doneQty,
          outputQty: metricsRes.metrics.outputQty,
          goodQty: metricsRes.metrics.goodQty,
          badQty: metricsRes.metrics.badQty,
          completionRate: metricsRes.metrics.completionRate,
          goodRate: metricsRes.metrics.goodRate,
          isTrueFpy: false,
          text: overviewText,
        },
        linePerformance: metricsRes.lines,
        alerts: analyzedAlerts,
        suggestions,
        mode,
        degraded: anyDegraded,
        snapshotAt,
        ...DEMO_SOURCE_META,
      };
    } catch (err: any) {
      // P2 整改：下游调用失败时如实记录失败审计
      if (this.aiProxy) {
        await this.aiProxy.logAiQuery({
          userId: userContext.userId,
          kind: 'report',
          question: `生产日报:${date}`,
          answer: null,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          latencyMs: totalLatencyMs,
          status: '失败',
        });
      }
      throw err;
    }
  }
}
