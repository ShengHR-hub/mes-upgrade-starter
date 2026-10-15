import crypto from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import {
  compareDateOnly,
  isValidDateOnly,
  nextDayDateOnly,
} from '../../common/utils/date-only.util.js';
import {
  toShanghaiRfc3339,
  toShanghaiSqlDateTime,
} from '../../common/utils/datetime.util.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { redactForLog } from '../../common/utils/redact.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';
import { AiProxyService } from '../ai-proxy/ai-proxy.service.js';
import type {
  InternalCauseItem,
  InternalEvidenceItem,
  InternalRootCauseRequest,
  UserContextDto,
} from '../ai-proxy/ai-proxy.types.js';
import { AuditService } from '../audit/audit.service.js';
import type { PureRuleEvaluationResult } from '../dashboards/dto/dashboard-response.dto.js';
import type { ProductionMetricsQueryDto } from '../dashboards/dto/production-metrics-query.dto.js';
import { MetricsAggregationService } from '../dashboards/metrics-aggregation.service.js';

import type { AlertStateTransitionDto } from './dto/alert-state-transition.dto.js';
import type { ListAlertsQueryDto } from './dto/list-alerts-query.dto.js';
import type {
  RootCauseAnalysisResponse,
  RootCauseCauseItem,
} from './dto/root-cause-analysis-response.dto.js';

export interface AlertItemResponse {
  id: string;
  level: string;
  type: string;
  title: string;
  content: string | null;
  refType: string | null;
  refId: string | null;
  status: string;
  createdAt: string | null;
  dataSource: string;
  dataLabel: string;
}

export interface AlertStateTransitionResponse {
  id: string;
  status: string;
  dataSource: string;
  dataLabel: string;
}

/**
 * 预警中心服务（B10 / F4 / 契约 §6.9）。
 *
 * 核心边界（§五 / §六）：
 * 1. 已持久化预警：提供只读列表与详情查询，支持候选流转；
 * 2. 内部规则评估：与驾驶舱完全共享数据口径（良品率<97%、完成率<90%、设备维修中），纯内存评估，不暗中写库；
 * 3. 根因分析（F4）：仅 admin 角色可发起，依据受控可靠证据查询同线设备、检验不良或物料批次；
 * 4. 证据不足或无异常时诚实标注，不编造因果与引用；
 * 5. 预警自动创建、去重周期、等级映射、直接关闭/重开等依赖 Q6，未获批准前不启用写入。
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly metricsService: MetricsAggregationService,
    @Optional() private readonly aiProxy?: AiProxyService,
  ) {}

  /**
   * 预警列表（GET /api/v1/alerts）
   */
  async list(query: ListAlertsQueryDto): Promise<PageResult<AlertItemResponse>> {
    const pagination = normalizePagination(query);

    if (query.startDate !== undefined && !isValidDateOnly(query.startDate)) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 必须为真实有效的 YYYY-MM-DD 日期' });
    }
    if (query.endDate !== undefined && !isValidDateOnly(query.endDate)) {
      throw invalidArgument({ field: 'endDate', reason: 'endDate 必须为真实有效的 YYYY-MM-DD 日期' });
    }
    if (
      query.startDate !== undefined &&
      query.endDate !== undefined &&
      compareDateOnly(query.startDate, query.endDate) > 0
    ) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 不得晚于 endDate' });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.type !== undefined) {
      conditions.push('a.type = ?');
      params.push(query.type);
    }
    if (query.level !== undefined) {
      conditions.push('a.level = ?');
      params.push(query.level);
    }
    if (query.status !== undefined) {
      conditions.push('a.status = ?');
      params.push(query.status);
    }
    if (query.startDate !== undefined) {
      conditions.push('a.created_at >= ?');
      params.push(`${query.startDate} 00:00:00`);
    }
    if (query.endDate !== undefined) {
      const nextDay = nextDayDateOnly(query.endDate);
      conditions.push('a.created_at < ?');
      params.push(`${nextDay} 00:00:00`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM alert a ${whereSql}`;
    const rowsSql = `
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
      ${whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `;

    const countRows = (await this.dataSource.query(countSql, params)) as any[];
    const total = Number(countRows[0]?.total ?? 0);

    const rows = (await this.dataSource.query(rowsSql, [
      ...params,
      pagination.take,
      pagination.skip,
    ])) as any[];

    const list: AlertItemResponse[] = rows.map((r) => {
      const epoch = Number(r.created_at_epoch);
      return {
        id: String(r.id),
        level: String(r.level),
        type: String(r.type),
        title: String(r.title),
        content: r.content !== null ? String(r.content) : null,
        refType: r.ref_type !== null ? String(r.ref_type) : null,
        refId: r.ref_id !== null ? String(r.ref_id) : null,
        status: String(r.status),
        createdAt: Number.isFinite(epoch)
          ? toShanghaiRfc3339(new Date(epoch * 1000))
          : null,
        ...DEMO_SOURCE_META,
      };
    });

    return buildPage(list, total, pagination.page, pagination.pageSize);
  }

  /**
   * 预警详情（GET /api/v1/alerts/{id}）
   */
  async getById(id: string): Promise<AlertItemResponse> {
    if (!isValidDecimalId(id)) {
      throw invalidArgument({ field: 'id', reason: 'id 必须为正整数且不超过 BIGINT 上限' });
    }

    const sql = `
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
      WHERE a.id = ?
    `;

    const rows = (await this.dataSource.query(sql, [id])) as any[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `预警 ID ${id} 不存在`);
    }

    const r = rows[0];
    const epoch = Number(r.created_at_epoch);

    return {
      id: String(r.id),
      level: String(r.level),
      type: String(r.type),
      title: String(r.title),
      content: r.content !== null ? String(r.content) : null,
      refType: r.ref_type !== null ? String(r.ref_type) : null,
      refId: r.ref_id !== null ? String(r.ref_id) : null,
      status: String(r.status),
      createdAt: Number.isFinite(epoch)
        ? toShanghaiRfc3339(new Date(epoch * 1000))
        : null,
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * 预警状态流转（POST /api/v1/alerts/{id}/state-transitions）
   */
  async transitionState(
    id: string,
    dto: AlertStateTransitionDto,
    context: { userId: string; ip: string | null },
  ): Promise<AlertStateTransitionResponse> {
    if (!isValidDecimalId(id)) {
      throw invalidArgument({ field: 'id', reason: 'id 必须为正整数且不超过 BIGINT 上限' });
    }

    void dto;
    void context;

    throw new BusinessException(
      ErrorCode.CAPABILITY_UNAVAILABLE,
      '预警状态流转依赖决策项 Q6（待决），未获批准前不启用业务写入。',
      { blockedBy: 'Q6' },
    );
  }

  /**
   * 纯规则评估对外复用接口（不写库）
   */
  async evaluateRules(
    query: ProductionMetricsQueryDto,
    snapshotAt: string,
  ): Promise<PureRuleEvaluationResult> {
    return this.metricsService.evaluateAlertRules(query, snapshotAt);
  }

  /**
   * 受控证据收集（仅依据受控关系与真实表快照，绝不猜测或补造实体）
   */
  async gatherControlledEvidence(
    alert: {
      id: string | number;
      type: string;
      title: string;
      content: string | null;
      ref_type: string | null;
      ref_id: string | number | null;
    },
    cutoffTime?: Date,
  ): Promise<InternalEvidenceItem[]> {
    const evidenceList: InternalEvidenceItem[] = [];
    const seenRefs = new Set<string>();

    const addEvidence = (ev: InternalEvidenceItem) => {
      if (!seenRefs.has(ev.ref)) {
        seenRefs.add(ev.ref);
        evidenceList.push(ev);
      }
    };

    const effectiveCutoff = cutoffTime || new Date();
    const cutoffStr = toShanghaiSqlDateTime(effectiveCutoff);
    const textToScan = `${alert.title || ''} ${alert.content || ''}`;

    // 1. 设备关联查询（同线设备、故障设备、设备日志）
    const devCodeMatch = textToScan.match(/EQP-[A-Za-z0-9-]+/);
    if (devCodeMatch) {
      const devCode = devCodeMatch[0];
      try {
        const devs = (await this.dataSource.query(
          'SELECT code, name, workshop, prod_line, status, remark FROM device WHERE code = ?',
          [devCode],
        )) as any[];
        if (devs.length > 0) {
          const d = devs[0];
          addEvidence({
            type: 'device',
            resourceId: d.code,
            ref: `device:${d.code}`,
            fact: `设备 ${d.code} (${d.name}) 当前资料状态为 ${d.status}（注：历史快照未记载，显示当前资料登记状态）${d.remark ? '，备注：' + d.remark : ''}`,
          });
        }

        // P2 整改：限制设备日志时间窗口 <= cutoffStr，不把未来发生的日志计入历史根因
        const logs = (await this.dataSource.query(
          'SELECT id, device_code, old_status, new_status, remark, changed_at FROM equipment_log WHERE device_code = ? AND changed_at <= ? ORDER BY changed_at DESC, id DESC LIMIT 2',
          [devCode, cutoffStr],
        )) as any[];
        for (const log of logs) {
          const timeStr =
            log.changed_at && !isNaN(new Date(log.changed_at).getTime())
              ? `于 ${toShanghaiRfc3339(new Date(log.changed_at))} `
              : '';
          addEvidence({
            type: 'device',
            resourceId: log.device_code,
            ref: `device:${log.device_code}:log:${log.id}`,
            fact: `设备状态${timeStr}变更为 ${log.new_status}，备注：${log.remark || '无'}`,
          });
        }
      } catch (err: any) {
        this.logger.warn(redactForLog(`受控收集设备证据异常 [${devCode}]: ${err?.message || err}`));
      }
    }

    // 2. 产线设备状态（检查同产线是否存在非运行中设备）
    // P2 整改：完整匹配受控产线标识，支持种子主数据“SMT-2线”与“SMT-2”，避免截断导致遗漏真实设备
    const lineMatch = textToScan.match(/(SMT-[123]|ASSY-[12]|DIP-[12]|CAL-[12])(?:线)?/i);
    if (lineMatch) {
      const rawPrefix = lineMatch[1].toUpperCase();
      const fullLineName = `${rawPrefix}线`;
      try {
        const abnormalDevs = (await this.dataSource.query(
          "SELECT code, name, prod_line, status, remark FROM device WHERE prod_line IN (?, ?) AND status != '运行中'",
          [fullLineName, rawPrefix],
        )) as any[];
        for (const d of abnormalDevs) {
          addEvidence({
            type: 'device',
            resourceId: d.code,
            ref: `device:${d.code}`,
            fact: `同线设备 ${d.code} (${d.name}，所在产线：${d.prod_line}) 资料状态为 ${d.status}（注：当前资料登记状态）${d.remark ? '，备注：' + d.remark : ''}`,
          });
        }
      } catch (err: any) {
        this.logger.warn(redactForLog(`受控收集同线设备证据异常 [${rawPrefix}]: ${err?.message || err}`));
      }
    }

    // 3. 工单关联（检验记录、不良品记录与物料批次）
    let workOrderId: string | number | null =
      alert.ref_type === 'work_order' && alert.ref_id ? alert.ref_id : null;
    if (!workOrderId) {
      const woCodeMatch = textToScan.match(/WO-\d+-\d+/);
      if (woCodeMatch) {
        try {
          const woRows = (await this.dataSource.query(
            'SELECT id FROM work_order WHERE code = ?',
            [woCodeMatch[0]],
          )) as any[];
          if (woRows.length > 0) {
            workOrderId = woRows[0].id;
          }
        } catch (err: any) {
          this.logger.warn(redactForLog(`受控匹配工单编号异常: ${err?.message || err}`));
        }
      }
    }

    if (workOrderId) {
      try {
        // P2 整改：质检与不良缺陷严格遵守时间边界 <= cutoffStr，排除后续质检记录
        const defects = (await this.dataSource.query(
          `
          SELECT q.id AS qc_id, q.result, q.check_qty, q.ng_qty, q.checked_at, d.id AS defect_id, d.defect_type, d.qty AS defect_qty, d.step_name
          FROM qc_record q
          JOIN defect d ON d.qc_record_id = q.id
          WHERE q.work_order_id = ? AND q.checked_at <= ?
          ORDER BY q.checked_at DESC
          LIMIT 5
        `,
          [workOrderId, cutoffStr],
        )) as any[];

        for (const def of defects) {
          addEvidence({
            type: 'quality',
            resourceId: `qc:${def.qc_id}`,
            ref: `qc:${def.qc_id}:defect:${def.defect_id}`,
            fact: `工序 ${def.step_name || '检验'} 发现缺陷：${def.defect_type}，数量：${def.defect_qty}`,
          });
        }

        // SN 追溯所用物料批次（亦限制生产时间 <= cutoffStr）
        const batches = (await this.dataSource.query(
          `
          SELECT DISTINCT mb.batch_no, mb.material_code, mb.inbound_at, mb.supplier
          FROM sn_trace st
          JOIN material_batch mb ON mb.id = st.batch_id
          WHERE st.work_order_id = ? AND st.produced_at <= ?
          LIMIT 3
        `,
          [workOrderId, cutoffStr],
        )) as any[];

        for (const b of batches) {
          addEvidence({
            type: 'material',
            resourceId: b.batch_no,
            ref: `material:${b.batch_no}`,
            fact: `关联物料批次 ${b.batch_no} (${b.material_code})，入库日期：${b.inbound_at}`,
          });
        }
      } catch (err: any) {
        this.logger.warn(redactForLog(`受控收集工单/质检证据异常 [WO=${workOrderId}]: ${err?.message || err}`));
      }
    }

    return evidenceList;
  }

  /**
   * 预警根因分析内部执行方法（供 F4 接口与 F2 日报共享，保证同一结构化结果）
   */
  async analyzeRootCauseForAlertRow(
    alertRow: {
      id: string | number;
      type: string;
      level?: string | null;
      title?: string | null;
      content?: string | null;
      ref_type?: string | null;
      ref_id?: string | number | null;
      status?: string | null;
      created_at_epoch?: number | null;
    },
    userContext: UserContextDto,
    snapshotAt: string,
    skipLog = false,
  ): Promise<RootCauseAnalysisResponse & { tokensIn?: number; tokensOut?: number; latencyMs?: number }> {
    const alertIdStr = String(alertRow.id);

    // P2 整改：依据预警生成时间或快照时间锁定证据时间边界
    const cutoffTime = Number.isFinite(Number(alertRow.created_at_epoch))
      ? new Date(Number(alertRow.created_at_epoch) * 1000)
      : new Date(snapshotAt);

    const evidenceList = await this.gatherControlledEvidence(
      {
        id: alertRow.id,
        type: alertRow.type,
        title: alertRow.title || '',
        content: alertRow.content || null,
        ref_type: alertRow.ref_type || null,
        ref_id: alertRow.ref_id || null,
      },
      cutoffTime,
    );

    const requestId = crypto.randomUUID();

    const internalReq: InternalRootCauseRequest = {
      alert: {
        id: alertIdStr,
        alertId: alertIdStr,
        type: String(alertRow.type),
        level: alertRow.level ? String(alertRow.level) : null,
        title: alertRow.title ? String(alertRow.title) : null,
        content: alertRow.content ? String(alertRow.content) : null,
        refType: alertRow.ref_type ? String(alertRow.ref_type) : null,
        refId: alertRow.ref_id ? String(alertRow.ref_id) : null,
        status: alertRow.status ? String(alertRow.status) : null,
        createdAt: Number.isFinite(Number(alertRow.created_at_epoch))
          ? toShanghaiRfc3339(new Date(Number(alertRow.created_at_epoch) * 1000))
          : null,
        dataSource: 'demo',
        dataLabel: '演示数据',
        possibleCauses: [],
      },
      evidence: evidenceList,
      snapshotAt,
      userContext,
      requestId,
    };

    let possibleCauses: RootCauseCauseItem[] = [];
    let suggestion: string | null = null;
    let analysisStatus = 'insufficient_evidence';
    let explanation: string | null = null;
    let mode = 'local';
    let degraded = false;
    let tokensIn = 0;
    let tokensOut = 0;
    let latencyMs = 0;

    if (this.aiProxy) {
      const aiRes = await this.aiProxy.callRootCauseAnalyses(internalReq);
      const validRefs = new Set(evidenceList.map((e) => e.ref));

      const rawCauses = Array.isArray(aiRes.possibleCauses) ? aiRes.possibleCauses : [];
      const hadRawCauses = rawCauses.length > 0;

      // P2 整改：剔除无效引用后，若某原因失去全部依据则予以删除
      possibleCauses = rawCauses
        .map((cause: InternalCauseItem) => ({
          text: cause.text,
          evidenceRefs: (cause.evidenceRefs || []).filter((ref: string) => validRefs.has(ref)),
        }))
        .filter((cause: RootCauseCauseItem) => cause.evidenceRefs.length > 0);

      mode = aiRes.mode;
      degraded = aiRes.degraded;
      tokensIn = aiRes.usage?.tokensIn ?? 0;
      tokensOut = aiRes.usage?.tokensOut ?? 0;
      latencyMs = aiRes.latencyMs ?? 0;

      if (aiRes.analysisStatus === 'no_anomaly') {
        // P2 整改：FastAPI 明确返回未见异常时，原样保留正常建议与状态，不得误覆写为证据不足
        analysisStatus = 'no_anomaly';
        suggestion = aiRes.suggestion || null;
        explanation = aiRes.explanation || null;
      } else if (hadRawCauses && possibleCauses.length === 0) {
        // 原因因虚假引用被全部删除，确认为无依据原因
        analysisStatus = 'insufficient_evidence';
        explanation = '未提供有效可溯源的关联证据，无法形成根因假设（已过滤无依据原因）。';
        suggestion = '建议先补充关联证据（设备状态、检验记录、物料批次等）后再进行根因分析。';
      } else if (possibleCauses.length === 0) {
        analysisStatus = aiRes.analysisStatus || 'insufficient_evidence';
        explanation = aiRes.explanation || '未提供有效可溯源的关联证据，无法形成根因假设。';
        suggestion = aiRes.suggestion || '建议先补充关联证据（设备状态、检验记录、物料批次等）后再进行根因分析。';
      } else {
        suggestion = aiRes.suggestion || null;
        analysisStatus = aiRes.analysisStatus || 'hypothesis';
        explanation = aiRes.explanation || null;
      }
    } else {
      // 本地替身/测试默认逻辑
      if (evidenceList.length > 0) {
        possibleCauses = [
          {
            text: `关联数据：${evidenceList.map((e) => e.fact).join('；')}。可能与本次预警相关。`,
            evidenceRefs: evidenceList.map((e) => e.ref),
          },
        ];
        analysisStatus = 'hypothesis';
        suggestion =
          alertRow.type.includes('质量')
            ? '建议质检员复核该时段不良类型与检验记录。'
            : '建议计划员核对剩余工序计划与可用产能。';
        explanation = null;
      } else {
        possibleCauses = [];
        analysisStatus = 'insufficient_evidence';
        suggestion = '建议先补充关联证据（设备状态、检验记录、物料批次等）后再进行根因分析。';
        explanation = '未提供可定位的关联证据，无法形成根因假设。';
      }
      mode = 'local';
      degraded = false;
    }

    if (!skipLog && this.aiProxy) {
      await this.aiProxy.logAiQuery({
        userId: userContext.userId,
        kind: 'root_cause',
        question: `预警根因分析:ID=${alertIdStr},标题=${alertRow.title || ''}`,
        answer: suggestion || JSON.stringify(possibleCauses),
        tokensIn,
        tokensOut,
        latencyMs,
        status: degraded ? '降级' : '成功',
      });
    }

    return {
      alertId: alertIdStr,
      possibleCauses,
      suggestion,
      analysisStatus,
      explanation,
      mode,
      degraded,
      snapshotAt,
      tokensIn,
      tokensOut,
      latencyMs,
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * 预警根因分析（POST /api/v1/alerts/{id}/root-cause-analyses）
   * 契约 §6.9 / F4：仅 admin 角色可访问。
   */
  async analyzeRootCause(
    id: string,
    user: AuthenticatedUser,
  ): Promise<RootCauseAnalysisResponse> {
    if (!isValidDecimalId(id)) {
      throw invalidArgument({ field: 'id', reason: 'id 必须为正整数且不超过 BIGINT 上限' });
    }

    const sql = `
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
      WHERE a.id = ?
    `;

    const rows = (await this.dataSource.query(sql, [id])) as any[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `预警 ID ${id} 不存在`);
    }

    const alertRow = rows[0];
    const snapshotAt = toShanghaiRfc3339();

    // P2 整改：若分析执行失败，记录 status: '失败' 至 ai_query_log
    try {
      return await this.analyzeRootCauseForAlertRow(
        alertRow,
        { userId: String(user.id), role: user.role },
        snapshotAt,
        false, // 外部独立请求：写一次 ai_query_log
      );
    } catch (err: any) {
      if (this.aiProxy) {
        await this.aiProxy.logAiQuery({
          userId: String(user.id),
          kind: 'root_cause',
          question: `预警根因分析:ID=${id},标题=${alertRow.title || ''}`,
          answer: null,
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          status: '失败',
        });
      }
      throw err;
    }
  }
}
