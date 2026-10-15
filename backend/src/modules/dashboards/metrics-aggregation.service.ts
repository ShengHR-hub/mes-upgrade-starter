import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import {
  compareDateOnly,
  isValidDateOnly,
  nextDayDateOnly,
} from '../../common/utils/date-only.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';
import { deriveOrderStatus, ORDER_STATUS } from '../orders/order-status.js';

import type {
  DashboardDeliveryMetricsResponse,
  DashboardDeviceMetricsResponse,
  DashboardProductionMetricsResponse,
  DashboardQualityMetricsResponse,
  LineProductionMetrics,
  PureRuleEvaluationResult,
  RuleEvaluationItem,
  SummaryProductionMetrics,
} from './dto/dashboard-response.dto.js';
import type { DeliveryMetricsQueryDto } from './dto/delivery-metrics-query.dto.js';
import type { DeviceMetricsQueryDto } from './dto/device-metrics-query.dto.js';
import type { ProductionMetricsQueryDto } from './dto/production-metrics-query.dto.js';
import type { QualityMetricsQueryDto } from './dto/quality-metrics-query.dto.js';
import { calculatePlanQtyInWindow } from './plan-allocation.util.js';

/**
 * 内部查询范围（S9 F3 扩展）：在对外 DTO 之上追加 `prodLines`
 * ——**别名解析后的产线实际名称集合**（种子数据存 `SMT-2线`，意图解析产出
 * 规范编号 `SMT-2`，映射由调用方完成）。仅内部受控查询使用，不对外 HTTP 开放，
 * 因此不进入对外 DTO；`prodLine`（单值）保持原语义不变。
 */
export type ProductionMetricsScope = ProductionMetricsQueryDto & { prodLines?: string[] };
export type QualityMetricsScope = QualityMetricsQueryDto & { prodLines?: string[] };

/** 产线过滤条件构造：优先使用别名解析后的实际名称集合（IN），否则保持单值语义 */
function appendProdLineFilter<T extends { prodLine?: string; prodLines?: string[] }>(
  query: T,
  column: string,
  conditions: string[],
  params: unknown[],
): void {
  const lines = (query.prodLines ?? []).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (lines.length > 0) {
    const placeholders = lines.map(() => '?').join(',');
    conditions.push(`${column} IN (${placeholders})`);
    params.push(...lines);
    return;
  }
  if (query.prodLine !== undefined) {
    if (query.prodLine === '未分配') {
      conditions.push(
        `(${column} IS NULL OR ${column} = "" OR ${column} = "未分配")`,
      );
    } else {
      conditions.push(`${column} = ?`);
      params.push(query.prodLine);
    }
  }
}

/**
 * 经营驾驶舱与跨模块权威指标聚合服务（B8 / 契约 §6.8）。
 *
 * 核心口径（契约 §6.8）：
 * 1. 产量和良品率：只统计末道工序有效报工，outputQty = goodQty + badQty，goodRate = goodQty / outputQty * 100；
 *    跨产线先加数量再算比率；归属使用末道任务 prodLine（null 为“未分配”）；isTrueFpy 恒为 false（报工良品率）。
 * 2. 每日计划：工单 planStart～planEnd 的 DATE 区间，前 N-1 天 floor(qty/N)，最后一天补差；
 * 3. 累计完成率：completionRate = doneQty / planTotalQty * 100；
 *    计划工单集合为计划区间与查询窗口相交的工单；planTotalQty 为入选工单总计划数量；doneQty 为入选工单截至统计截止时刻的末道累计良品；
 * 4. 时间与快照：业务时区 Asia/Shanghai，历史截止到对应日末，今天截止到 snapshotAt；历史累计良品从末道 report 重建；
 * 5. 空值与缺失：有效计划且无报工完成率 0 良品率 null；空工单集合完成率 null；缺失计划日期 insufficient_data。
 */
@Injectable()
export class MetricsAggregationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 生产指标与产线对比（GET /api/v1/dashboards/production-metrics）
   */
  async getProductionMetrics(
    query: ProductionMetricsScope,
    snapshotAt: string,
  ): Promise<DashboardProductionMetricsResponse> {
    this.validateDateRange(query.startDate, query.endDate);

    const windowStart = `${query.startDate} 00:00:00`;
    const nextDay = nextDayDateOnly(query.endDate);
    const nextDayEnd = `${nextDay} 00:00:00`;
    const currentShanghaiDate = snapshotAt.slice(0, 10);
    const isHistorical = compareDateOnly(query.endDate, currentShanghaiDate) < 0;
    const effectiveCutoff = isHistorical ? nextDayEnd : snapshotAt;

    // 一致性读：把缺计划检查、候选工单集合、窗口报工及累计读所依赖的全部输入纳入同一事务/执行器快照
    const executeInTransaction = async <T>(run: (executor: any) => Promise<T>): Promise<T> => {
      const ds = this.dataSource as any;
      if (typeof ds?.transaction === 'function') {
        if (ds.transaction.length === 1) {
          return ds.transaction(run);
        }
        return ds.transaction('REPEATABLE READ', run);
      }
      return run(this.dataSource);
    };

    const {
      missingPlanCount,
      validCandidateWorkOrders,
      invalidPlanCount,
      windowReports,
      cumulativeMap,
    } = await executeInTransaction(async (executor) => {
      // 1. 检查是否存在无合法计划起止日期却属于所选范围的工单
      const missingCount = await this.checkMissingPlanDates(query, executor);

      // 2. 查询计划区间与查询窗口相交的候选工单集合
      const candidates = await this.queryCandidateWorkOrders(query, executor);

      // 校验候选工单并过滤非法逆序计划（F3：逆序工单不抛 500，标记为数据不完整）
      const validCandidates: any[] = [];
      let invalidCount = 0;
      for (const wo of candidates) {
        if (
          !wo.plan_start ||
          !wo.plan_end ||
          compareDateOnly(wo.plan_start, wo.plan_end) > 0
        ) {
          invalidCount++;
        } else {
          validCandidates.push(wo);
        }
      }

      // 3. 查询查询窗口内的末道工序报工记录
      const reports = await this.queryWindowLastReports(
        query,
        windowStart,
        nextDayEnd,
        snapshotAt,
        executor,
      );

      // 4. 重建候选工单截至 effectiveCutoff 的末道累计良品（F2：严格半开历史边界）
      const cumulative = await this.queryCumulativeDoneQty(
        validCandidates,
        effectiveCutoff,
        isHistorical,
        nextDayEnd,
        executor,
      );

      return {
        missingPlanCount: missingCount,
        validCandidateWorkOrders: validCandidates,
        invalidPlanCount: invalidCount,
        windowReports: reports,
        cumulativeMap: cumulative,
      };
    });

    // 5. 按产线归集（末道任务 prod_line，缺失归入“未分配”）
    const allProdLines = new Set<string>();
    for (const wo of validCandidateWorkOrders) {
      allProdLines.add(wo.prod_line ?? '未分配');
    }
    for (const r of windowReports) {
      allProdLines.add(r.prod_line ?? '未分配');
    }

    // 若有显式指定产线过滤且无任何数据，保持该产线键
    if (query.prodLine && allProdLines.size === 0) {
      allProdLines.add(query.prodLine);
    }

    const hasDataDefect = missingPlanCount > 0 || invalidPlanCount > 0;
    const lines: LineProductionMetrics[] = [];
    const sortedLines = Array.from(allProdLines).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    for (const line of sortedLines) {
      const lineWos = validCandidateWorkOrders.filter((wo) => (wo.prod_line ?? '未分配') === line);
      const lineReports = windowReports.filter((r) => (r.prod_line ?? '未分配') === line);

      let linePlanQty = 0;
      let linePlanTotalQty = 0;
      let lineDoneQty = 0;

      for (const wo of lineWos) {
        linePlanTotalQty += wo.qty;
        linePlanQty += calculatePlanQtyInWindow(
          wo.qty,
          wo.plan_start,
          wo.plan_end,
          query.startDate,
          query.endDate,
        );

        // 严格遵循契约累计口径：累计良品由 cumulativeMap 提供，不能用当日窗口产量覆盖或截断历史累计量
        const woDone = cumulativeMap.get(String(wo.id)) ?? 0;
        lineDoneQty += woDone;
      }

      let lineGoodQty = 0;
      let lineBadQty = 0;
      for (const r of lineReports) {
        lineGoodQty += r.good_qty;
        lineBadQty += r.bad_qty;
      }
      const lineOutputQty = lineGoodQty + lineBadQty;

      const lineCompletionRate =
        !hasDataDefect && linePlanTotalQty > 0
          ? Number(((lineDoneQty / linePlanTotalQty) * 100).toFixed(2))
          : null;

      const lineGoodRate =
        lineOutputQty > 0 ? Number(((lineGoodQty / lineOutputQty) * 100).toFixed(2)) : null;

      lines.push({
        prodLine: line,
        planQty: linePlanQty,
        planTotalQty: linePlanTotalQty,
        doneQty: lineDoneQty,
        outputQty: lineOutputQty,
        goodQty: lineGoodQty,
        badQty: lineBadQty,
        completionRate: lineCompletionRate,
        goodRate: lineGoodRate,
      });
    }

    // 6. 跨产线总计：先加数量再算比率，不平均产线比率
    let summaryPlanQty = 0;
    let summaryPlanTotalQty = 0;
    let summaryDoneQty = 0;
    let summaryOutputQty = 0;
    let summaryGoodQty = 0;
    let summaryBadQty = 0;

    for (const l of lines) {
      summaryPlanQty += l.planQty;
      summaryPlanTotalQty += l.planTotalQty;
      summaryDoneQty += l.doneQty;
      summaryOutputQty += l.outputQty;
      summaryGoodQty += l.goodQty;
      summaryBadQty += l.badQty;
    }

    const summaryCompletionRate =
      !hasDataDefect && summaryPlanTotalQty > 0
        ? Number(((summaryDoneQty / summaryPlanTotalQty) * 100).toFixed(2))
        : null;

    const summaryGoodRate =
      summaryOutputQty > 0 ? Number(((summaryGoodQty / summaryOutputQty) * 100).toFixed(2)) : null;

    let calculationStatus: 'available' | 'no_data' | 'insufficient_data' = 'available';
    let missingInputs: string[] | undefined = undefined;

    if (hasDataDefect) {
      calculationStatus = 'insufficient_data';
      missingInputs = ['所选范围内存在计划起止日期缺失或非法的工单'];
    } else if (validCandidateWorkOrders.length === 0 && windowReports.length === 0) {
      calculationStatus = 'no_data';
    }

    const summaryMetrics: SummaryProductionMetrics = {
      planQty: summaryPlanQty,
      planTotalQty: summaryPlanTotalQty,
      doneQty: summaryDoneQty,
      outputQty: summaryOutputQty,
      goodQty: summaryGoodQty,
      badQty: summaryBadQty,
      completionRate: summaryCompletionRate,
      goodRate: summaryGoodRate,
      isTrueFpy: false,
      calculationStatus,
      ...(missingInputs ? { missingInputs } : {}),
    };

    return {
      startDate: query.startDate,
      endDate: query.endDate,
      snapshotAt,
      metrics: summaryMetrics,
      lines,
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * 质量指标（GET /api/v1/dashboards/quality-metrics）
   */
  async getQualityMetrics(
    query: QualityMetricsScope,
    snapshotAt: string,
  ): Promise<DashboardQualityMetricsResponse> {
    this.validateDateRange(query.startDate, query.endDate);

    const windowStart = `${query.startDate} 00:00:00`;
    const nextDay = nextDayDateOnly(query.endDate);
    const nextDayEnd = `${nextDay} 00:00:00`;

    const windowReports = await this.queryWindowLastReports(query, windowStart, nextDayEnd, snapshotAt);

    let goodQty = 0;
    let badQty = 0;
    for (const r of windowReports) {
      goodQty += r.good_qty;
      badQty += r.bad_qty;
    }
    const outputQty = goodQty + badQty;
    const goodRate = outputQty > 0 ? Number(((goodQty / outputQty) * 100).toFixed(2)) : null;

    return {
      goodQty,
      badQty,
      goodRate,
      isTrueFpy: false,
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * 设备指标（GET /api/v1/dashboards/device-metrics）
   */
  async getDeviceMetrics(
    query: DeviceMetricsQueryDto,
    snapshotAt: string,
  ): Promise<DashboardDeviceMetricsResponse> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.workshop !== undefined) {
      if (query.workshop === '未分配') {
        conditions.push('(workshop IS NULL OR workshop = "" OR workshop = "未分配")');
      } else {
        conditions.push('workshop = ?');
        params.push(query.workshop);
      }
    }
    if (query.prodLine !== undefined) {
      if (query.prodLine === '未分配') {
        conditions.push('(prod_line IS NULL OR prod_line = "" OR prod_line = "未分配")');
      } else {
        conditions.push('prod_line = ?');
        params.push(query.prodLine);
      }
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT status, COUNT(*) AS cnt
      FROM device
      ${whereSql}
      GROUP BY status
    `;

    const rows = (await this.dataSource.query(sql, params)) as Array<{ status: string; cnt: unknown }>;

    const counts: { 运行中: number; 待机: number; 维修中: number; 停机: number } = {
      运行中: 0,
      待机: 0,
      维修中: 0,
      停机: 0,
    };

    for (const row of rows) {
      const s = row.status as keyof typeof counts;
      if (s in counts) {
        counts[s] = Number(row.cnt);
      }
    }

    return {
      counts,
      oee: null,
      calculationStatus: 'insufficient_data',
      missingInputs: ['计划生产时间', '设备产出归属', '理想节拍'],
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * 交付指标（GET /api/v1/dashboards/delivery-metrics）
   *
   * 按 dueDate 筛选订单；按 §6.2 既有 Q1 规则判定当前完成/延期状态。
   */
  async getDeliveryMetrics(
    query: DeliveryMetricsQueryDto,
    snapshotAt: string,
  ): Promise<DashboardDeliveryMetricsResponse> {
    this.validateDateRange(query.startDate, query.endDate);

    const conditions: string[] = [
      'o.due_date >= ?',
      'o.due_date <= ?',
    ];
    const params: unknown[] = [query.startDate, query.endDate];

    if (query.productCode !== undefined) {
      conditions.push('o.product_code = ?');
      params.push(query.productCode);
    }

    const sql = `
      SELECT
        o.id,
        o.status AS base_status,
        DATE_FORMAT(o.due_date, '%Y-%m-%d') AS due_date,
        COUNT(w.id) AS work_order_total,
        SUM(CASE WHEN w.status <> '完工' THEN 1 ELSE 0 END) AS work_order_open,
        SUM(CASE WHEN w.status = '在产' THEN 1 ELSE 0 END) AS work_order_active
      FROM sale_order o
      LEFT JOIN work_order w ON w.sale_order_id = o.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY o.id, o.status, o.due_date
    `;

    const rows = (await this.dataSource.query(sql, params)) as any[];
    const businessDate = snapshotAt.slice(0, 10);

    let completedOrderCount = 0;
    let delayedOrderCount = 0;

    for (const row of rows) {
      const derived = deriveOrderStatus({
        baseStatus: row.base_status,
        workOrderTotal: Number(row.work_order_total ?? 0),
        workOrderOpen: Number(row.work_order_open ?? 0),
        workOrderActive: Number(row.work_order_active ?? 0),
        dueDate: row.due_date,
        businessDate,
      });

      if (derived === ORDER_STATUS.COMPLETED) {
        completedOrderCount++;
      } else if (derived === ORDER_STATUS.DELAYED) {
        delayedOrderCount++;
      }
    }

    const orderCount = rows.length;

    return {
      orderCount,
      completedOrderCount,
      delayedOrderCount,
      calculationStatus: orderCount > 0 ? 'available' : 'no_data',
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * 纯规则评估逻辑（区分“满足触发条件”与“已持久化预警”）
   *
   * 严格遵循已批准的触发条件（§五）：
   * 1. 报工良品率 goodRate < 97%（恰好 97% 不触发，null 不触发）；
   * 2. 累计完成率 completionRate < 90%（恰好 90% 不触发，null 不触发）；
   * 3. 设备状态为“维修中”。
   *
   * 纯只读评估，绝不向数据库写入任何预警记录。
   */
  async evaluateAlertRules(
    query: ProductionMetricsQueryDto,
    snapshotAt: string,
  ): Promise<PureRuleEvaluationResult> {
    const prodMetrics = await this.getProductionMetrics(query, snapshotAt);
    const devMetrics = await this.getDeviceMetrics(
      { workshop: query.workshop, prodLine: query.prodLine },
      snapshotAt,
    );

    const evaluations: RuleEvaluationItem[] = [];

    // 规则 1：报工良品率低于 97%（F4: 严格按数量关系计算，避免显示两位舍入导致 96.996% 漏报）
    const actualGoodRate = prodMetrics.metrics.goodRate;
    const outputQty = prodMetrics.metrics.outputQty;
    const goodQty = prodMetrics.metrics.goodQty;
    const goodRateTriggered =
      actualGoodRate !== null &&
      (outputQty > 0 ? goodQty * 100 < 97 * outputQty : actualGoodRate < 97);

    evaluations.push({
      ruleId: 'goodRate',
      ruleName: '报工良品率低于97%（质量异常）',
      threshold: 97,
      actualValue: actualGoodRate,
      unit: '%',
      triggered: goodRateTriggered,
      explanation:
        actualGoodRate === null
          ? '无有效报工产出，良品率为 null，不触发预警'
          : goodRateTriggered
            ? `报工良品率 ${actualGoodRate}% 低于阈值 97%（非真实FPY）`
            : `报工良品率 ${actualGoodRate}% 处于合格范围（>= 97%）`,
      level: '重要',
      type: '质量异常',
      title: `${query.prodLine || '全厂'}良品率低于97%`,
      content:
        actualGoodRate !== null
          ? `演示报工良品率${actualGoodRate.toFixed(2)}%，不等同于真实FPY`
          : '无报工产出',
      refType: null,
      refId: null,
    });

    // 规则 2：累计完成率低于 90%（F3 & F4: 数据缺陷时不可用，且按精确数量关系判定）
    const isInsufficient = prodMetrics.metrics.calculationStatus === 'insufficient_data';
    const actualCompRate = prodMetrics.metrics.completionRate;
    const planTotalQty = prodMetrics.metrics.planTotalQty;
    const doneQty = prodMetrics.metrics.doneQty;
    const compRateTriggered =
      !isInsufficient &&
      actualCompRate !== null &&
      (planTotalQty > 0 ? doneQty * 100 < 90 * planTotalQty : actualCompRate < 90);

    evaluations.push({
      ruleId: 'completionRate',
      ruleName: '累计完成率低于90%（交付风险）',
      threshold: 90,
      actualValue: actualCompRate,
      unit: '%',
      triggered: compRateTriggered,
      explanation:
        isInsufficient
          ? '所选范围内存在计划起止日期缺失或非法的工单，数据不完整，不触发交付预警'
          : actualCompRate === null
            ? '无有效计划工单或计划总数为 0，完成率为 null，不触发预警'
            : compRateTriggered
              ? `累计完成率 ${actualCompRate}% 低于阈值 90%（基于计划总数 ${prodMetrics.metrics.planTotalQty} 件）`
              : `累计完成率 ${actualCompRate}% 正常（>= 90%）`,
      level: '重要',
      type: '延期风险',
      title: `${query.prodLine || '全厂'}累计完成率低于90%`,
      content:
        actualCompRate !== null
          ? `演示累计完成率${actualCompRate.toFixed(2)}%，累计良品${prodMetrics.metrics.doneQty}件，计划总数${prodMetrics.metrics.planTotalQty}件`
          : '无计划工单',
      refType: null,
      refId: null,
    });

    // 规则 3：设备状态为“维修中”
    const maintenanceCount = devMetrics.counts['维修中'];
    const deviceTriggered = maintenanceCount > 0;
    evaluations.push({
      ruleId: 'deviceMaintenance',
      ruleName: '设备状态为“维修中”（设备停机）',
      threshold: '无维修设备',
      actualValue: maintenanceCount,
      unit: '台',
      triggered: deviceTriggered,
      explanation: deviceTriggered
        ? `发现 ${maintenanceCount} 台设备处于“维修中”状态`
        : '所有设备状态正常，无维修中设备',
      level: '重要',
      type: '设备停机',
      title: '设备处于维修中',
      content: deviceTriggered ? `存在 ${maintenanceCount} 台设备维修中` : '无异常',
      refType: null,
      refId: null,
    });

    const triggeredCount = evaluations.filter((e) => e.triggered).length;

    return {
      snapshotAt,
      evaluations,
      triggeredCount,
    };
  }

  // ---------------------------------------------------------------- 私有辅助查询

  private validateDateRange(startDate: string, endDate: string): void {
    if (!isValidDateOnly(startDate)) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 必须为真实有效的 YYYY-MM-DD 日期' });
    }
    if (!isValidDateOnly(endDate)) {
      throw invalidArgument({ field: 'endDate', reason: 'endDate 必须为真实有效的 YYYY-MM-DD 日期' });
    }
    if (compareDateOnly(startDate, endDate) > 0) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 不得晚于 endDate' });
    }
  }

  private async checkMissingPlanDates(
    query: ProductionMetricsScope,
    executor: { query: (sql: string, params?: unknown[]) => Promise<any> } = this.dataSource,
  ): Promise<number> {
    const conditions: string[] = [
      '(wo.plan_start IS NULL OR wo.plan_end IS NULL OR wo.plan_start > wo.plan_end)',
    ];
    const params: unknown[] = [];

    if (query.productCode !== undefined) {
      conditions.push('wo.product_code = ?');
      params.push(query.productCode);
    }
    if (query.workshop !== undefined) {
      if (query.workshop === '未分配') {
        conditions.push('(last_task.workshop IS NULL OR last_task.workshop = "" OR last_task.workshop = "未分配")');
      } else {
        conditions.push('last_task.workshop = ?');
        params.push(query.workshop);
      }
    }
    appendProdLineFilter(query, 'last_task.prod_line', conditions, params);

    const sql = `
      SELECT COUNT(DISTINCT wo.id) AS cnt
      FROM work_order wo
      LEFT JOIN (
        SELECT wt.work_order_id, wt.workshop, wt.prod_line
        FROM work_task wt
        WHERE wt.seq = (
          SELECT MAX(wt2.seq)
          FROM work_task wt2
          WHERE wt2.work_order_id = wt.work_order_id
        )
      ) last_task ON last_task.work_order_id = wo.id
      WHERE ${conditions.join(' AND ')}
    `;

    const rows = (await executor.query(sql, params)) as any[];
    return Number(rows[0]?.cnt ?? 0);
  }

  private async queryCandidateWorkOrders(
    query: ProductionMetricsScope,
    executor: { query: (sql: string, params?: unknown[]) => Promise<any> } = this.dataSource,
  ): Promise<any[]> {
    const conditions: string[] = [
      'wo.plan_start IS NOT NULL',
      'wo.plan_end IS NOT NULL',
      'wo.plan_start <= wo.plan_end',
      'wo.plan_start <= ?',
      'wo.plan_end >= ?',
    ];
    const params: unknown[] = [query.endDate, query.startDate];

    if (query.productCode !== undefined) {
      conditions.push('wo.product_code = ?');
      params.push(query.productCode);
    }
    if (query.workshop !== undefined) {
      if (query.workshop === '未分配') {
        conditions.push('(last_task.workshop IS NULL OR last_task.workshop = "" OR last_task.workshop = "未分配")');
      } else {
        conditions.push('last_task.workshop = ?');
        params.push(query.workshop);
      }
    }
    appendProdLineFilter(query, 'last_task.prod_line', conditions, params);

    const sql = `
      SELECT
        wo.id,
        wo.code,
        wo.product_code,
        wo.qty,
        wo.done_qty,
        DATE_FORMAT(wo.plan_start, '%Y-%m-%d') AS plan_start,
        DATE_FORMAT(wo.plan_end, '%Y-%m-%d') AS plan_end,
        last_task.workshop,
        last_task.prod_line
      FROM work_order wo
      LEFT JOIN (
        SELECT wt.work_order_id, wt.workshop, wt.prod_line
        FROM work_task wt
        WHERE wt.seq = (
          SELECT MAX(wt2.seq)
          FROM work_task wt2
          WHERE wt2.work_order_id = wt.work_order_id
        )
      ) last_task ON last_task.work_order_id = wo.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY wo.id ASC
    `;

    return (await executor.query(sql, params)) as any[];
  }

  private async queryWindowLastReports(
    query: ProductionMetricsScope | QualityMetricsScope,
    windowStart: string,
    nextDayEnd: string,
    snapshotAt: string,
    executor: { query: (sql: string, params?: unknown[]) => Promise<any> } = this.dataSource,
  ): Promise<any[]> {
    const conditions: string[] = [
      'r.reported_at >= ?',
      'r.reported_at < ?',
      'r.reported_at <= ?',
    ];
    const params: unknown[] = [windowStart, nextDayEnd, snapshotAt];

    if (query.productCode !== undefined) {
      conditions.push('wo.product_code = ?');
      params.push(query.productCode);
    }
    if (query.workshop !== undefined) {
      if (query.workshop === '未分配') {
        conditions.push('(last_task.workshop IS NULL OR last_task.workshop = "" OR last_task.workshop = "未分配")');
      } else {
        conditions.push('last_task.workshop = ?');
        params.push(query.workshop);
      }
    }
    appendProdLineFilter(query, 'last_task.prod_line', conditions, params);

    const sql = `
      SELECT
        r.good_qty,
        r.bad_qty,
        UNIX_TIMESTAMP(r.reported_at) AS reported_at_epoch,
        last_task.prod_line,
        last_task.workshop,
        wo.id AS work_order_id
      FROM report r
      JOIN work_task wt ON r.task_id = wt.id
      JOIN work_order wo ON wt.work_order_id = wo.id
      JOIN (
        SELECT wt2.work_order_id, wt2.seq, wt2.prod_line, wt2.workshop
        FROM work_task wt2
        WHERE wt2.seq = (
          SELECT MAX(wt3.seq)
          FROM work_task wt3
          WHERE wt3.work_order_id = wt2.work_order_id
        )
      ) last_task ON last_task.work_order_id = wo.id AND last_task.seq = wt.seq
      WHERE ${conditions.join(' AND ')}
    `;

    return (await executor.query(sql, params)) as any[];
  }

  private async queryCumulativeDoneQty(
    candidateWorkOrders: any[],
    effectiveCutoff: string,
    isHistorical = false,
    nextDayEnd?: string,
    executor: { query: (sql: string, params?: unknown[]) => Promise<any> } = this.dataSource,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (candidateWorkOrders.length === 0) return map;

    const ids = candidateWorkOrders.map((w) => w.id);
    const placeholders = ids.map(() => '?').join(',');

    const sql = `
      SELECT
        wo.id AS work_order_id,
        COALESCE(SUM(r.good_qty), 0) AS cumulative_good_qty
      FROM work_order wo
      JOIN work_task wt ON wt.work_order_id = wo.id
      JOIN report r ON r.task_id = wt.id
      WHERE wo.id IN (${placeholders})
        AND wt.seq = (
          SELECT MAX(wt2.seq)
          FROM work_task wt2
          WHERE wt2.work_order_id = wo.id
        )
        ${isHistorical ? 'AND r.reported_at < ?' : 'AND r.reported_at < ? AND r.reported_at <= ?'}
      GROUP BY wo.id
    `;

    const queryParams = isHistorical
      ? [...ids, nextDayEnd ?? effectiveCutoff]
      : [...ids, nextDayEnd ?? effectiveCutoff, effectiveCutoff];

    const rows = (await executor.query(sql, queryParams)) as any[];
    for (const row of rows) {
      map.set(String(row.work_order_id), Number(row.cumulative_good_qty));
    }
    return map;
  }
}
