import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import {
  addDaysDateOnly,
  compareDateOnly,
  isValidDateOnly,
} from '../../common/utils/date-only.util.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';
import { AiProxyService } from '../ai-proxy/ai-proxy.service.js';
import type {
  InternalQueryIntentSpec,
  UserContextDto,
} from '../ai-proxy/ai-proxy.types.js';
import { MetricsAggregationService } from '../dashboards/metrics-aggregation.service.js';

import type { DataQueryDto } from './dto/data-query.dto.js';
import type {
  QueryAnswerResponse,
  QueryGroupBy,
  QueryMetric,
} from './dto/query-answer-response.dto.js';
import {
  ALLOWED_QUERY_GROUPS,
  ALLOWED_QUERY_METRICS,
  DataQueriesQueryExecutor,
  hasExplicitDateHint,
  isAllowedQueryCombo,
} from './data-queries.query.js';

/**
 * F3 智能问数服务（契约 §7.1 / §4.1）。
 *
 * 流程：自然语言 →（FastAPI 意图解析）→ NestJS 白名单复核 → 显式参数仲裁 →
 * 近 7 天窗口校验 → 受控查询（复用 S7 聚合口径）→（FastAPI 回答生成，只转述数字）
 * → 单条 ai_query_log 审计（两次内部调用汇总 usage/latency）。
 *
 * 边界：
 * 1. NestJS 是唯一业务事实入口；数字只来自受控查询，模型不补数字；
 * 2. 不执行模型生成的任意 SQL；查询全部参数化，时间范围 ≤ 7 天，行数受限；
 * 3. 模糊/未知/缺失/越界一律澄清或无数据，不猜数、不把 null 改 0；
 * 4. 只读：本服务不写任何业务表（仅追加 ai_query_log 审计）；
 * 5. 身份来自已认证上下文（userContext 由 NestJS 传入），不信任请求体自报角色。
 */
@Injectable()
export class DataQueriesService {
  constructor(
    private readonly executor: DataQueriesQueryExecutor,
    private readonly metricsService: MetricsAggregationService,
    private readonly aiProxy: AiProxyService,
  ) {}

  async queryData(
    dto: DataQueryDto,
    user: AuthenticatedUser,
  ): Promise<QueryAnswerResponse> {
    const question = (dto.question ?? '').trim();
    if (!question) {
      throw invalidArgument({ field: 'question', reason: 'question 不能为空白字符串' });
    }

    // P2 修复：DTO 的 @IsOptional 会跳过 null，服务层显式拒绝，避免 null.trim() 500
    if (dto.startDate === null || dto.endDate === null || dto.prodLine === null) {
      throw invalidArgument({
        field: 'startDate',
        reason: 'startDate / endDate / prodLine 不允许为 null；不提供请省略字段',
      });
    }

    const snapshotAt = toShanghaiRfc3339(new Date());
    const today = snapshotAt.slice(0, 10);
    const userContext: UserContextDto = { userId: String(user.id), role: user.role };

    // ---- 显式参数完备性（在任何 AI 调用之前，避免无谓下游开销）----
    const hasStart = dto.startDate !== undefined;
    const hasEnd = dto.endDate !== undefined;
    if (hasStart !== hasEnd) {
      throw invalidArgument({
        field: 'startDate',
        reason: 'startDate 与 endDate 必须同时提供',
      });
    }
    if (hasStart && hasEnd) {
      if (!isValidDateOnly(dto.startDate) || !isValidDateOnly(dto.endDate)) {
        throw invalidArgument({
          field: 'startDate',
          reason: '显式日期必须是真实有效的 YYYY-MM-DD 日期',
        });
      }
      if (compareDateOnly(dto.startDate!, dto.endDate!) > 0) {
        throw invalidArgument({ field: 'startDate', reason: 'startDate 不得晚于 endDate' });
      }
    }
    if (dto.prodLine !== undefined && !dto.prodLine.trim()) {
      throw invalidArgument({ field: 'prodLine', reason: 'prodLine 不能为空白字符串' });
    }

    const usage = { tokensIn: 0, tokensOut: 0, latencyMs: 0 };

    // ---- 1. 自然语言 → 受控意图（唯一允许的转换路径）----
    let intent: InternalQueryIntentSpec;
    try {
      const intentRes = await this.aiProxy.callQueryIntents({
        question,
        dateContext: { today, timeZone: 'Asia/Shanghai' },
        userContext,
        requestId: crypto.randomUUID(),
      });
      usage.tokensIn += intentRes.usage?.tokensIn ?? 0;
      usage.tokensOut += intentRes.usage?.tokensOut ?? 0;
      usage.latencyMs += intentRes.latencyMs ?? 0;

      if (!intentRes.supported || !intentRes.intent) {
        const clarification =
          (intentRes.reason ?? '').trim() ||
          '当前问题无法解析为受支持的查询意图，请换一种问法（例如询问报工良品率、累计完成率、良品数、不良数、产量、不良类型或设备状态）。';
        await this.writeAudit(userContext, question, clarification, usage, '成功');
        return {
          answerStatus: 'clarification_required',
          answer: clarification,
          clarification,
          query: null,
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        };
      }
      intent = intentRes.intent;
    } catch (err) {
      await this.writeAudit(userContext, question, null, usage, '失败');
      throw err;
    }

    try {
      // ---- 2. NestJS 白名单独立复核（绝不以下游取值直接放行查询）----
      const whitelistReason = this.checkIntentWhitelist(intent);
      if (whitelistReason) {
        await this.writeAudit(userContext, question, whitelistReason, usage, '成功');
        return {
          answerStatus: 'clarification_required',
          answer: whitelistReason,
          clarification: whitelistReason,
          query: null,
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        };
      }

      // ---- 3. 显式参数与自然语言范围仲裁（冲突 → 10001 要求重述）----
      let prodLine = intent.prodLine;
      if (dto.prodLine !== undefined) {
        const explicitLine = dto.prodLine.trim();
        if (intent.prodLine !== null && intent.prodLine !== explicitLine) {
          throw invalidArgument({
            field: 'prodLine',
            reason: `显式 prodLine「${explicitLine}」与问题中识别的产线「${intent.prodLine}」不一致，请重述`,
          });
        }
        prodLine = explicitLine;
      }
      let startDate = intent.startDate;
      let endDate = intent.endDate;
      if (hasStart && hasEnd) {
        const matchesIntent =
          dto.startDate === intent.startDate && dto.endDate === intent.endDate;
        if (!matchesIntent) {
          if (hasExplicitDateHint(question)) {
            throw invalidArgument({
              field: 'startDate',
              reason: '显式日期范围与问题中识别的时间范围不一致，请重述',
            });
          }
          // 问题无显式日期表述时，显式参数是用户对查询范围的补充声明，生效
          startDate = dto.startDate!;
          endDate = dto.endDate!;
        }
      }

      // ---- 4. 近 7 天窗口（契约 §7.1：只覆盖部署的近 7 天含当天）----
      const minAllowedDate = addDaysDateOnly(today, -6);
      if (
        compareDateOnly(startDate, minAllowedDate) < 0 ||
        compareDateOnly(endDate, today) > 0
      ) {
        const answer =
          `所查询时间范围（${startDate} 至 ${endDate}）超出可用数据窗口：` +
          `本版仅覆盖 ${minAllowedDate} 至 ${today} 的近 7 天演示数据；` +
          '未查询任何数据，也不制造窗口外历史数据。';
        await this.writeAudit(userContext, question, answer, usage, '成功');
        return {
          answerStatus: 'no_data',
          answer,
          clarification: null,
          query: this.buildQuerySpec(intent, startDate, endDate, prodLine),
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        };
      }

      // ---- 4b. deviceStatus 仅支持当前快照（S9 审查 P2-3）----
      // 历史日期没有设备状态流水可回放（equipment_log 不是本指标来源），
      // 直接读取当前 device.status 会误导为历史状态 → 拒绝并要求重述。
      if (
        intent.metric === 'deviceStatus' &&
        (startDate !== today || endDate !== today)
      ) {
        const clarification =
          '设备状态仅支持查询当前快照（不提供历史状态回放）；请用「现在各台设备状态怎么样」提问。';
        await this.writeAudit(userContext, question, clarification, usage, '成功');
        return {
          answerStatus: 'clarification_required',
          answer: clarification,
          clarification,
          query: null,
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        };
      }

      // ---- 5. 受控查询（参数化 SQL + S7 聚合口径复用）----
      const result = await this.executor.execute(
        intent.metric as QueryMetric,
        intent.groupBy as QueryGroupBy,
        startDate,
        endDate,
        prodLine,
        snapshotAt,
        this.metricsService,
      );

      if (result.unknownProdLineReason) {
        await this.writeAudit(userContext, question, result.unknownProdLineReason, usage, '成功');
        return {
          answerStatus: 'no_data',
          answer: result.unknownProdLineReason,
          clarification: null,
          query: this.buildQuerySpec(intent, startDate, endDate, prodLine),
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        };
      }

      if (result.planInsufficientReason) {
        await this.writeAudit(userContext, question, result.planInsufficientReason, usage, '成功');
        return {
          answerStatus: 'no_data',
          answer: result.planInsufficientReason,
          clarification: null,
          query: this.buildQuerySpec(intent, startDate, endDate, prodLine),
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        };
      }

      // ---- 6. 回答生成（FastAPI 只转述 queryResult 数字，不补数字）----
      const answerRes = await this.aiProxy.callQueryAnswers({
        question,
        queryResult: {
          answerStatus: 'answered',
          answer: null,
          query: { metric: intent.metric, startDate, endDate, prodLine },
          columns: result.columns,
          rows: result.rows,
          sources: result.sources,
          mode: 'local',
          degraded: false,
          snapshotAt,
          ...DEMO_SOURCE_META,
        },
        userContext,
        requestId: crypto.randomUUID(),
      });
      usage.tokensIn += answerRes.usage?.tokensIn ?? 0;
      usage.tokensOut += answerRes.usage?.tokensOut ?? 0;
      usage.latencyMs += answerRes.latencyMs ?? 0;

      const degraded = answerRes.degraded;
      await this.writeAudit(userContext, question, answerRes.answer, usage, degraded ? '降级' : '成功');

      return {
        answerStatus: answerRes.answerStatus as QueryAnswerResponse['answerStatus'],
        answer: answerRes.answer,
        clarification: null,
        query: this.buildQuerySpec(intent, startDate, endDate, prodLine),
        columns: result.columns,
        rows: result.rows,
        sources: result.sources,
        mode: answerRes.mode,
        degraded,
        snapshotAt,
        ...DEMO_SOURCE_META,
      };
    } catch (err) {
      await this.writeAudit(userContext, question, null, usage, '失败');
      throw err;
    }
  }

  // ---------------------------------------------------------------- 私有辅助

  /**
   * NestJS 侧意图白名单复核。返回拒绝原因（非空即拒绝），null 表示放行。
   */
  private checkIntentWhitelist(intent: InternalQueryIntentSpec): string | null {
    const { metric, groupBy, operation } = intent;
    if (!ALLOWED_QUERY_METRICS.includes(metric as QueryMetric)) {
      return `服务端白名单复核拒绝：metric「${metric}」不在受支持集合内。`;
    }
    if (!ALLOWED_QUERY_GROUPS.includes(groupBy as QueryGroupBy)) {
      return `服务端白名单复核拒绝：groupBy「${groupBy}」不在受支持集合内。`;
    }
    if (!isAllowedQueryCombo(metric as QueryMetric, groupBy as QueryGroupBy, operation)) {
      return `服务端白名单复核拒绝：不支持的组合 metric=${metric} / groupBy=${groupBy} / operation=${operation}。`;
    }
    if (!isValidDateOnly(intent.startDate) || !isValidDateOnly(intent.endDate)) {
      return '服务端白名单复核拒绝：意图中的日期不是真实有效的日历日。';
    }
    if (compareDateOnly(intent.startDate, intent.endDate) > 0) {
      return '服务端白名单复核拒绝：意图中的开始日期晚于结束日期。';
    }
    if (
      intent.prodLine !== null &&
      intent.prodLine !== undefined &&
      (typeof intent.prodLine !== 'string' || intent.prodLine.length > 32)
    ) {
      return '服务端白名单复核拒绝：意图中的 prodLine 必须为不超过 32 字符的字符串或 null。';
    }
    return null;
  }

  private buildQuerySpec(
    intent: InternalQueryIntentSpec,
    startDate: string,
    endDate: string,
    prodLine: string | null,
  ): NonNullable<QueryAnswerResponse['query']> {
    return {
      metric: intent.metric as QueryMetric,
      groupBy: intent.groupBy as QueryGroupBy,
      operation: intent.operation as NonNullable<QueryAnswerResponse['query']>['operation'],
      startDate,
      endDate,
      prodLine,
    };
  }

  /**
   * 审计：每次用户请求只写一条 ai_query_log。
   * `sqlGenerated` 恒为 null —— 本版为「意图 → 受控查询 → 文本回答」，
   * 不生成也不执行任意 SQL（契约 §4.1）。
   */
  private async writeAudit(
    userContext: UserContextDto,
    question: string,
    answer: string | null,
    usage: { tokensIn: number; tokensOut: number; latencyMs: number },
    status: '成功' | '失败' | '降级',
  ): Promise<void> {
    await this.aiProxy.logAiQuery({
      userId: userContext.userId,
      kind: 'nl_query',
      question,
      sqlGenerated: null,
      answer,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      latencyMs: usage.latencyMs,
      status,
    });
  }
}
