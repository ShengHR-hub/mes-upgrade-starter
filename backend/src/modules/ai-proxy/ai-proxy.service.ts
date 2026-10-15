import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { redactForLog } from '../../common/utils/redact.util.js';

import type {
  InternalDailyReportRequest,
  InternalDailyReportResponseData,
  InternalEnvelope,
  InternalQueryAnswerRequest,
  InternalQueryAnswerResponseData,
  InternalQueryIntentRequest,
  InternalQueryIntentResponseData,
  InternalRootCauseRequest,
  InternalRootCauseResponseData,
} from './ai-proxy.types.js';

export interface LogAiQueryOptions {
  userId?: string | null;
  kind: 'report' | 'root_cause' | 'nl_query' | 'rag';
  question: string;
  sqlGenerated?: string | null;
  answer?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  status: '成功' | '失败' | '降级';
}

/**
 * AI 服务内部代理服务（S8 / 契约 §4 / §7）。
 *
 * 职责：
 * 1. 负责向 FastAPI (127.0.0.1:8000) 发起内部受控 HTTP 请求；
 * 2. 注入专用 `AI_SERVICE_TOKEN`（不使用用户 JWT 替代服务凭证）；
 * 3. 严格校验内部响应包体、错误码及核心字段；
 * 4. 真实记录 `ai_query_log`（tokens、latencyMs、status），上游未提供时如实记 0，不编造用量；
 * 5. 绝不把密钥、服务令牌或完整 JWT 写入日志或对外返回。
 */
@Injectable()
export class AiProxyService {
  private readonly logger = new Logger(AiProxyService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private getBaseUrl(): string {
    const url =
      this.config.get<string>('AI_SERVICE_URL') ||
      process.env.AI_SERVICE_URL ||
      'http://127.0.0.1:8000';
    return url.replace(/\/+$/, '');
  }

  private getServiceToken(): string {
    return (
      this.config.get<string>('AI_SERVICE_TOKEN') ||
      process.env.AI_SERVICE_TOKEN ||
      ''
    ).trim();
  }

  /**
   * 内部请求调用通用封装
   */
  private async requestFastApi<T>(
    path: string,
    body: Record<string, any>,
    requestId: string,
    timeoutMs = 5000,
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const token = this.getServiceToken();
    const targetUrl = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    let responseJson: InternalEnvelope<T>;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      try {
        responseJson = (await response.json()) as InternalEnvelope<T>;
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          throw err;
        }
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          `AI 服务返回非 JSON 响应（HTTP ${response.status}）`,
        );
      }
    } catch (err: any) {
      if (err instanceof BusinessException) {
        throw err;
      }
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_TIMEOUT,
          `AI 服务调用超时（>${timeoutMs}ms）`,
        );
      }
      this.logger.error(
        redactForLog(
          `FastAPI 连接失败 [${path}]: ${err?.message || '网络连接异常'}`,
        ),
      );
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务不可用或无法连接',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok || responseJson.code !== 0) {
      const code = responseJson.code ?? response.status;
      const rawMessage = responseJson.message || `HTTP ${response.status}`;

      if (response.status === 401 || code === 20001) {
        throw new BusinessException(
          ErrorCode.INTERNAL_ERROR,
          'AI 服务内部鉴权失败：AI_SERVICE_TOKEN 无效或缺失',
        );
      }
      if (code === 10001 || response.status === 400 || response.status === 422) {
        // P1 整改：记录下游真实原因至脱敏日志，但公开响应绝不透传下游未清洗的错误串
        this.logger.warn(
          redactForLog(`AI 服务参数校验拒绝 [${path}]: ${rawMessage}`),
        );
        throw new BusinessException(
          ErrorCode.INVALID_ARGUMENT,
          'AI 服务参数校验拒绝',
        );
      }
      this.logger.error(
        redactForLog(`AI 服务处理异常 [${path}]: ${rawMessage}`),
      );
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务处理异常',
      );
    }

    if (!responseJson.data || typeof responseJson.data !== 'object') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回包体缺少有效 data 节点',
      );
    }

    return responseJson.data;
  }

  /**
   * 校验使用量与耗时通用字段
   */
  private validateUsageAndLatency(data: any): void {
    if (data.usage !== undefined && data.usage !== null) {
      if (typeof data.usage !== 'object' || Array.isArray(data.usage)) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          'AI 服务返回 usage 节点非有效对象',
        );
      }
      const { tokensIn, tokensOut } = data.usage;
      if (
        tokensIn !== undefined &&
        tokensIn !== null &&
        (typeof tokensIn !== 'number' || !Number.isInteger(tokensIn) || tokensIn < 0)
      ) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          'AI 服务返回 tokensIn 必须为非负整数',
        );
      }
      if (
        tokensOut !== undefined &&
        tokensOut !== null &&
        (typeof tokensOut !== 'number' || !Number.isInteger(tokensOut) || tokensOut < 0)
      ) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          'AI 服务返回 tokensOut 必须为非负整数',
        );
      }
    }
    if (
      data.latencyMs !== undefined &&
      data.latencyMs !== null &&
      (typeof data.latencyMs !== 'number' || Number.isNaN(data.latencyMs) || data.latencyMs < 0)
    ) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回 latencyMs 必须为非负数',
      );
    }
  }

  /**
   * 运行时结构校验：根因分析响应数据
   */
  private validateRootCauseData(
    data: any,
  ): InternalRootCauseResponseData {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回根因数据非有效对象',
      );
    }
    if (!Array.isArray(data.possibleCauses)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回根因数据缺少 possibleCauses 数组',
      );
    }
    for (let i = 0; i < data.possibleCauses.length; i++) {
      const cause = data.possibleCauses[i];
      if (!cause || typeof cause !== 'object' || Array.isArray(cause)) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          `AI 服务返回 possibleCauses[${i}] 非有效对象`,
        );
      }
      if (typeof cause.text !== 'string' || cause.text.trim().length === 0) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          `AI 服务返回 possibleCauses[${i}].text 必须为非空字符串`,
        );
      }
      if (!Array.isArray(cause.evidenceRefs)) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          `AI 服务返回 possibleCauses[${i}].evidenceRefs 必须为数组`,
        );
      }
      for (let j = 0; j < cause.evidenceRefs.length; j++) {
        if (typeof cause.evidenceRefs[j] !== 'string') {
          throw new BusinessException(
            ErrorCode.DEPENDENCY_UNAVAILABLE,
            `AI 服务返回 possibleCauses[${i}].evidenceRefs[${j}] 必须为字符串`,
          );
        }
      }
    }

    const validStatuses = new Set([
      'hypothesis',
      'insufficient_evidence',
      'no_anomaly',
      'confirmed',
    ]);
    if (typeof data.analysisStatus !== 'string' || !validStatuses.has(data.analysisStatus)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        `AI 服务返回根因数据 analysisStatus 非法: ${data.analysisStatus}`,
      );
    }
    const validModes = new Set(['local', 'llm', 'local_rule']);
    if (typeof data.mode !== 'string' || !validModes.has(data.mode)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        `AI 服务返回根因数据 mode 标识非法: ${data.mode}`,
      );
    }
    if (typeof data.degraded !== 'boolean') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回根因数据 degraded 必须为布尔值',
      );
    }
    if (data.suggestion !== undefined && data.suggestion !== null && typeof data.suggestion !== 'string') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回根因数据 suggestion 必须为字符串或 null',
      );
    }
    if (data.explanation !== undefined && data.explanation !== null && typeof data.explanation !== 'string') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回根因数据 explanation 必须为字符串或 null',
      );
    }

    this.validateUsageAndLatency(data);

    return data as InternalRootCauseResponseData;
  }

  /**
   * 运行时结构校验：日报响应数据
   */
  private validateDailyReportData(
    data: any,
  ): InternalDailyReportResponseData {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据非有效对象',
      );
    }
    const validAnswerStatuses = new Set(['answered', 'no_data']);
    if (typeof data.answerStatus !== 'string' || !validAnswerStatuses.has(data.answerStatus)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        `AI 服务返回日报数据 answerStatus 非法: ${data.answerStatus}`,
      );
    }
    if (!data.overview || typeof data.overview !== 'object' || Array.isArray(data.overview)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据缺少 overview 节点',
      );
    }
    if (!Array.isArray(data.linePerformance)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据缺少 linePerformance 产线数组',
      );
    }
    if (!Array.isArray(data.alerts)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据缺少 alerts 预警数组',
      );
    }
    if (!Array.isArray(data.suggestions)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据缺少 suggestions 建议数组',
      );
    }
    for (let i = 0; i < data.suggestions.length; i++) {
      if (typeof data.suggestions[i] !== 'string') {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          `AI 服务返回 suggestions[${i}] 必须为字符串`,
        );
      }
    }
    const validModes = new Set(['local', 'llm', 'local_rule']);
    if (typeof data.mode !== 'string' || !validModes.has(data.mode)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        `AI 服务返回日报数据 mode 标识非法: ${data.mode}`,
      );
    }
    if (typeof data.degraded !== 'boolean') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据 degraded 必须为布尔值',
      );
    }
    if (
      typeof data.overviewText !== 'string' &&
      typeof (data.overview as any).text !== 'string'
    ) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回日报数据缺少 overviewText 综述文本',
      );
    }

    this.validateUsageAndLatency(data);

    return data as InternalDailyReportResponseData;
  }

  /**
   * 调用内部 F4 根因分析接口（POST /api/v1/ai/root-cause-analyses）
   */
  async callRootCauseAnalyses(
    payload: InternalRootCauseRequest,
  ): Promise<InternalRootCauseResponseData> {
    const rawData = await this.requestFastApi<InternalRootCauseResponseData>(
      '/api/v1/ai/root-cause-analyses',
      payload,
      payload.requestId,
    );
    return this.validateRootCauseData(rawData);
  }

  /**
   * 调用内部 F2 日报组装接口（POST /api/v1/ai/daily-reports）
   */
  async callDailyReports(
    payload: InternalDailyReportRequest,
  ): Promise<InternalDailyReportResponseData> {
    const rawData = await this.requestFastApi<InternalDailyReportResponseData>(
      '/api/v1/ai/daily-reports',
      payload,
      payload.requestId,
    );
    return this.validateDailyReportData(rawData);
  }

  // ---------------------------------------------------------------- F3 智能问数（S9）

  /**
   * 运行时结构校验：意图解析响应数据
   *
   * 只校验**结构与类型**：业务白名单（metric/groupBy/operation 组合矩阵、
   * 日历真实性、日期窗口）由 data-queries 服务在 NestJS 侧独立复核，
   * 绝不以下游返回值直接放行业务查询。
   */
  private validateQueryIntentData(
    data: any,
  ): InternalQueryIntentResponseData {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回意图数据非有效对象',
      );
    }
    if (typeof data.supported !== 'boolean') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回意图数据 supported 必须为布尔值',
      );
    }
    if (data.supported === true) {
      const intent = data.intent;
      if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          'AI 服务返回 supported=true 但缺少 intent 对象',
        );
      }
      for (const key of ['metric', 'groupBy', 'operation', 'startDate', 'endDate']) {
        if (typeof intent[key] !== 'string' || intent[key].trim().length === 0) {
          throw new BusinessException(
            ErrorCode.DEPENDENCY_UNAVAILABLE,
            `AI 服务返回 intent.${key} 必须为非空字符串`,
          );
        }
      }
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      for (const key of ['startDate', 'endDate']) {
        if (!datePattern.test(intent[key])) {
          throw new BusinessException(
            ErrorCode.DEPENDENCY_UNAVAILABLE,
            `AI 服务返回 intent.${key} 必须为 YYYY-MM-DD 格式`,
          );
        }
      }
      if (
        intent.prodLine !== undefined &&
        intent.prodLine !== null &&
        typeof intent.prodLine !== 'string'
      ) {
        throw new BusinessException(
          ErrorCode.DEPENDENCY_UNAVAILABLE,
          'AI 服务返回 intent.prodLine 必须为字符串或 null',
        );
      }
    } else if (
      data.reason !== undefined &&
      data.reason !== null &&
      typeof data.reason !== 'string'
    ) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回 reason 必须为字符串或 null',
      );
    }

    this.validateUsageAndLatency(data);

    return data as InternalQueryIntentResponseData;
  }

  /**
   * 运行时结构校验：回答生成响应数据
   */
  private validateQueryAnswerData(
    data: any,
  ): InternalQueryAnswerResponseData {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回问数回答非有效对象',
      );
    }
    const validAnswerStatuses = new Set(['answered', 'no_data']);
    if (typeof data.answerStatus !== 'string' || !validAnswerStatuses.has(data.answerStatus)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        `AI 服务返回问数回答 answerStatus 非法: ${data.answerStatus}`,
      );
    }
    if (typeof data.answer !== 'string' || data.answer.trim().length === 0) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回问数回答 answer 必须为非空字符串',
      );
    }
    const validModes = new Set(['local', 'llm', 'local_rule']);
    if (typeof data.mode !== 'string' || !validModes.has(data.mode)) {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回问数回答 mode 标识非法',
      );
    }
    if (typeof data.degraded !== 'boolean') {
      throw new BusinessException(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'AI 服务返回问数回答 degraded 必须为布尔值',
      );
    }

    this.validateUsageAndLatency(data);

    return data as InternalQueryAnswerResponseData;
  }

  /**
   * 调用内部 F3 意图解析接口（POST /api/v1/ai/query-intents）
   */
  async callQueryIntents(
    payload: InternalQueryIntentRequest,
  ): Promise<InternalQueryIntentResponseData> {
    const rawData = await this.requestFastApi<InternalQueryIntentResponseData>(
      '/api/v1/ai/query-intents',
      payload,
      payload.requestId,
    );
    return this.validateQueryIntentData(rawData);
  }

  /**
   * 调用内部 F3 回答生成接口（POST /api/v1/ai/query-answers）
   */
  async callQueryAnswers(
    payload: InternalQueryAnswerRequest,
  ): Promise<InternalQueryAnswerResponseData> {
    const rawData = await this.requestFastApi<InternalQueryAnswerResponseData>(
      '/api/v1/ai/query-answers',
      payload,
      payload.requestId,
    );
    return this.validateQueryAnswerData(rawData);
  }

  /**
   * 记录 AI 查询日志（写 ai_query_log 表）
   */
  async logAiQuery(options: LogAiQueryOptions): Promise<void> {
    try {
      const sql = `
        INSERT INTO ai_query_log (
          user_id,
          kind,
          question,
          sql_generated,
          answer,
          tokens_in,
          tokens_out,
          latency_ms,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // P1 整改：写入边界统一脱敏，防范敏感文本/口令标记进入审计库
      const params = [
        options.userId ? String(options.userId) : null,
        options.kind,
        options.question ? redactForLog(options.question) : '',
        options.sqlGenerated ? redactForLog(options.sqlGenerated) : null,
        options.answer ? redactForLog(options.answer) : null,
        options.tokensIn ?? 0,
        options.tokensOut ?? 0,
        options.latencyMs ?? 0,
        options.status,
      ];

      await this.dataSource.query(sql, params);
    } catch (err: any) {
      // 契约与安全要求：日志记录失败不能泄露敏感凭证，并如实输出系统告警
      this.logger.error(
        redactForLog(`记录 ai_query_log 失败: ${err?.message || err}`),
      );
    }
  }
}
