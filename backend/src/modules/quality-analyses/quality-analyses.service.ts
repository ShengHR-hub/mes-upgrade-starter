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

import type { GoodRateQueryDto, ParetoQueryDto, TrendQueryDto } from './dto/quality-analysis-query.dto.js';
import { buildParetoItems, reportBadRate, reportRate } from './pareto.util.js';

export interface ParetoItemResponse {
  defectType: string;
  qty: number;
  share: number;
  cumulativeShare: number;
}

export interface ParetoResponse {
  items: ParetoItemResponse[];
  totalDefectQty: number;
  calculationStatus: 'available' | 'no_data';
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

export interface TrendPointResponse {
  date: string;
  goodQty: number;
  badQty: number;
  badRate: number | null;
}

export interface TrendResponse {
  metric: 'reportBadRate';
  points: TrendPointResponse[];
  calculationStatus: 'available' | 'no_data';
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

export interface GoodRateResponse {
  metric: 'reportGoodRate';
  value: number | null;
  isTrueFpy: false;
  calculationStatus: 'available' | 'no_data';
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

interface AnalysisScope {
  windowStart: string;
  windowEnd: string;
  lineCondition: string;
  lineParams: unknown[];
}

/**
 * B11 SPC 质量分析服务 —— 契约 §6.5。
 *
 * 数据口径（与契约 §6.5 / §6.8 一致）：
 * - Pareto：`defect.qty`，日期窗口按 `qc_record.checked_at` 严格半开区间；
 * - 趋势 / 良品率：**只用报工数量**（`report.good_qty / bad_qty`），
 *   不把质检 `ng_qty` 重复加进报工数量；
 * - 产线归属只能由工序任务（`work_task.prod_line`）推断：无任务的检验不能推断产线，
 *   请求指定产线时不纳入这些记录；
 * - 良品率恒标注 `isTrueFpy:false`（报工良品率 ≠ 真实 FPY）。
 */
@Injectable()
export class QualityAnalysesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 日期窗口与产线条件（半开区间，Asia/Shanghai 口径） */
  private resolveScope(
    query: ParetoQueryDto | TrendQueryDto | GoodRateQueryDto,
    taskAlias: string,
  ): AnalysisScope {
    if (!isValidDateOnly(query.startDate)) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 必须为真实存在的日期（YYYY-MM-DD）' });
    }
    if (!isValidDateOnly(query.endDate)) {
      throw invalidArgument({ field: 'endDate', reason: 'endDate 必须为真实存在的日期（YYYY-MM-DD）' });
    }
    if (compareDateOnly(query.startDate, query.endDate) > 0) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 不得晚于 endDate' });
    }

    const windowStart = `${query.startDate} 00:00:00`;
    const windowEnd = `${nextDayDateOnly(query.endDate)} 00:00:00`;

    let lineCondition = '';
    const lineParams: unknown[] = [];
    if (query.prodLine !== undefined) {
      if (query.prodLine === '未分配') {
        lineCondition = `AND (${taskAlias}.prod_line IS NULL OR ${taskAlias}.prod_line = '' OR ${taskAlias}.prod_line = '未分配')`;
      } else {
        lineCondition = `AND ${taskAlias}.prod_line = ?`;
        lineParams.push(query.prodLine);
      }
    }

    return { windowStart, windowEnd, lineCondition, lineParams };
  }

  /**
   * 一致性读执行器：与 B8 同一模式 —— REPEATABLE READ 事务内读取，
   * 失败直接向上传播（S7 审查：不静默降级重跑）。
   */
  private async readConsistently<T>(run: (executor: DataSource) => Promise<T>): Promise<T> {
    const ds = this.dataSource as unknown as {
      transaction?: (...args: unknown[]) => Promise<T>;
    };
    if (typeof ds?.transaction === 'function') {
      if (ds.transaction.length === 1) {
        return ds.transaction(run as never);
      }
      return ds.transaction('REPEATABLE READ', run as never);
    }
    return run(this.dataSource);
  }

  /** GET /quality-analyses/paretos —— 不良品 Pareto（defect.qty） */
  async pareto(query: ParetoQueryDto, snapshotAt: string): Promise<ParetoResponse> {
    const scope = this.resolveScope(query, 't');

    const rows = (await this.readConsistently(async (executor) =>
      executor.query(
        `SELECT d.defect_type AS defect_type, SUM(d.qty) AS qty
         FROM defect d
         JOIN qc_record q ON d.qc_record_id = q.id
         LEFT JOIN work_task t ON q.task_id = t.id
         WHERE q.checked_at >= ? AND q.checked_at < ? ${scope.lineCondition}
         GROUP BY d.defect_type`,
        [scope.windowStart, scope.windowEnd, ...scope.lineParams],
      ),
    )) as Array<{ defect_type: unknown; qty: unknown }>;

    const rawItems = rows.map((row) => ({
      defectType: String(row.defect_type),
      qty: Number(row.qty ?? 0),
    }));
    const totalDefectQty = rawItems.reduce((sum, item) => sum + item.qty, 0);

    return {
      items: buildParetoItems(rawItems, totalDefectQty),
      totalDefectQty,
      calculationStatus: totalDefectQty > 0 ? 'available' : 'no_data',
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }

  /** GET /quality-analyses/trends —— 工序报工不良率趋势（reportBadRate） */
  async trends(query: TrendQueryDto, snapshotAt: string): Promise<TrendResponse> {
    const scope = this.resolveScope(query, 't');

    const conditions: string[] = ['r.reported_at >= ?', 'r.reported_at < ?'];
    const params: unknown[] = [scope.windowStart, scope.windowEnd];
    if (scope.lineCondition) {
      conditions.push(scope.lineCondition.replace(/^AND /, ''));
      params.push(...scope.lineParams);
    }
    if (query.stepName !== undefined) {
      conditions.push('t.step_name = ?');
      params.push(query.stepName);
    }

    const rows = (await this.readConsistently(async (executor) =>
      executor.query(
        `SELECT DATE_FORMAT(r.reported_at, '%Y-%m-%d') AS report_date,
                COALESCE(SUM(r.good_qty), 0) AS good_qty,
                COALESCE(SUM(r.bad_qty), 0) AS bad_qty
         FROM report r
         JOIN work_task t ON r.task_id = t.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY report_date
         ORDER BY report_date ASC`,
        params,
      ),
    )) as Array<{ report_date: unknown; good_qty: unknown; bad_qty: unknown }>;

    const points: TrendPointResponse[] = rows.map((row) => {
      const goodQty = Number(row.good_qty ?? 0);
      const badQty = Number(row.bad_qty ?? 0);
      return {
        date: String(row.report_date),
        goodQty,
        badQty,
        badRate: reportBadRate(goodQty, badQty),
      };
    });

    return {
      metric: 'reportBadRate',
      points,
      calculationStatus: points.length > 0 ? 'available' : 'no_data',
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }

  /** GET /quality-analyses/good-rates —— 报工良品率（isTrueFpy 恒为 false） */
  async goodRates(query: GoodRateQueryDto, snapshotAt: string): Promise<GoodRateResponse> {
    const scope = this.resolveScope(query, 't');

    const rows = (await this.readConsistently(async (executor) =>
      executor.query(
        `SELECT COALESCE(SUM(r.good_qty), 0) AS good_qty,
                COALESCE(SUM(r.bad_qty), 0) AS bad_qty,
                COUNT(*) AS report_count
         FROM report r
         JOIN work_task t ON r.task_id = t.id
         WHERE r.reported_at >= ? AND r.reported_at < ? ${scope.lineCondition}`,
        [scope.windowStart, scope.windowEnd, ...scope.lineParams],
      ),
    )) as Array<{ good_qty: unknown; bad_qty: unknown; report_count: unknown }>;

    const row = rows[0];
    const goodQty = Number(row?.good_qty ?? 0);
    const badQty = Number(row?.bad_qty ?? 0);
    const reportCount = Number(row?.report_count ?? 0);
    const hasData = reportCount > 0 && goodQty + badQty > 0;

    return {
      metric: 'reportGoodRate',
      value: hasData ? reportRate(goodQty, badQty) : null,
      isTrueFpy: false,
      calculationStatus: hasData ? 'available' : 'no_data',
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }
}
