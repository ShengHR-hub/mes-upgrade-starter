import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  compareDateOnly,
  isValidDateOnly,
  nextDayDateOnly,
} from '../../common/utils/date-only.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';
import type { MetricsAggregationService } from '../dashboards/metrics-aggregation.service.js';

import type {
  QueryColumn,
  QueryGroupBy,
  QueryMetric,
  QueryRow,
  QuerySource,
} from './dto/query-answer-response.dto.js';

/**
 * F3 受控查询执行器（S9 / 契约 §4.1、§7.1）。
 *
 * 边界：
 * 1. 只执行**白名单内**的指标/维度/日期范围，全部走参数化 SQL，绝不执行模型生成的 SQL；
 * 2. 报工类指标复用 S7 `MetricsAggregationService` 聚合口径与快照，不在本文件另算指标；
 * 3. 逐日趋势按各日期实际工单集合与截止时刻计算（半开区间），不用当前累计值回填历史日期；
 * 4. null 表示已知缺失/无法计算，不把 null 改成 0（契约 §2.1）。
 */

/** 契约 §4.1：内部意图白名单（与 ai-service 同口径，NestJS 侧独立复核） */
export const ALLOWED_QUERY_METRICS: readonly QueryMetric[] = [
  'goodRate',
  'completionRate',
  'goodQty',
  'badQty',
  'outputQty',
  'defectQty',
  'deviceStatus',
];

export const ALLOWED_QUERY_GROUPS: readonly QueryGroupBy[] = [
  'prodLine',
  'date',
  'defectType',
  'device',
];

export const ALLOWED_QUERY_OPERATIONS = ['list', 'trend', 'minimum', 'maximum'] as const;

/**
 * 契约 §4.1 组合矩阵（非笛卡尔积；**必须与执行器实际能力严格一致**）。
 *
 * S9 审查 P2 修复：原矩阵放行了 `outputQty/device/list` 等执行器未实现的分组，
 * 导致响应列声明 device 而行结构实为日期/产线。收紧规则：
 * - `deviceStatus`：仅 groupBy=device + operation=list（当前快照）；
 * - `defectQty`：groupBy ∈ {defectType, prodLine, date}；
 * - 其余指标：groupBy ∈ {prodLine, date}（无设备级产量归属，不支持 device 分组）；
 * - `trend` 仅 date；`minimum/maximum` 仅 prodLine/date（可比维度）。
 */
export function isAllowedQueryCombo(
  metric: QueryMetric,
  groupBy: QueryGroupBy,
  operation: string,
): boolean {
  if (
    !ALLOWED_QUERY_METRICS.includes(metric) ||
    !ALLOWED_QUERY_GROUPS.includes(groupBy) ||
    !ALLOWED_QUERY_OPERATIONS.includes(operation as any)
  ) {
    return false;
  }
  if (metric === 'deviceStatus') {
    return groupBy === 'device' && operation === 'list';
  }
  const groupAllowlist: readonly QueryGroupBy[] =
    metric === 'defectQty' ? ['defectType', 'prodLine', 'date'] : ['prodLine', 'date'];
  if (!groupAllowlist.includes(groupBy)) {
    return false;
  }
  if (operation === 'trend') {
    return groupBy === 'date';
  }
  if (operation === 'minimum' || operation === 'maximum') {
    return groupBy === 'prodLine' || groupBy === 'date';
  }
  return true;
}

/** 指标列标签与单位（契约 §7.1：比率单位为 %，数量单位为件） */
export const QUERY_METRIC_LABELS: Record<QueryMetric, { label: string; unit?: string }> = {
  goodRate: { label: '报工良品率', unit: '%' },
  completionRate: { label: '累计完成率', unit: '%' },
  goodQty: { label: '良品数量', unit: '件' },
  badQty: { label: '不良品数量', unit: '件' },
  outputQty: { label: '产出数量', unit: '件' },
  defectQty: { label: '不良数量', unit: '件' },
  deviceStatus: { label: '设备状态' },
};

/** 维度列标签 */
export const QUERY_DIM_LABELS: Record<QueryGroupBy, string> = {
  date: '日期',
  prodLine: '产线',
  defectType: '不良类型',
  device: '设备',
};

/** 趋势行数据状态（契约 §7.1：每天有显式状态） */
export type RowDataStatus = 'available' | 'no_data' | 'insufficient_data';

export interface ControlledQueryResult {
  columns: QueryColumn[];
  rows: QueryRow[];
  sources: QuerySource[];
  /**
   * completionRate 查询时，所选范围内存在计划起止日期缺失/非法的工单 →
   * NestJS 据此返回 no_data 并说明缺失原因，不猜日计划（契约 §6.8）。
   */
  planInsufficientReason: string | null;
  /**
   * 指定产线在数据库中不存在任何匹配的实际名称（含别名）时非空 →
   * NestJS 据此返回 no_data 并说明产线未命中，**绝不静默扩大为全厂查询**。
   */
  unknownProdLineReason: string | null;
}

/** 查询窗口天数上限（成本护栏：只覆盖部署的近 7 天） */
const MAX_QUERY_DAYS = 7;

@Injectable()
export class DataQueriesQueryExecutor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 执行受控查询。入参 intent 必须是**已通过 NestJS 白名单复核**的意图。
   *
   * `prodLine` 是意图解析产出的**规范编号**（如 `SMT-2`）；种子数据实际存
   * `SMT-2线`，因此这里先做别名解析得到数据库中真实名称集合再过滤，
   * 绝不因为名称不匹配就丢弃过滤条件（S9 审查 P2-1）。
   */
  async execute(
    metric: QueryMetric,
    groupBy: QueryGroupBy,
    startDate: string,
    endDate: string,
    prodLine: string | null,
    snapshotAt: string,
    metricsService: MetricsAggregationService,
  ): Promise<ControlledQueryResult> {
    if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
      throw invalidArgument({ field: 'startDate', reason: '查询日期必须是真实有效的 YYYY-MM-DD 日期' });
    }
    if (compareDateOnly(startDate, endDate) > 0) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 不得晚于 endDate' });
    }
    const days = countDays(startDate, endDate);
    if (days > MAX_QUERY_DAYS) {
      throw invalidArgument({
        field: 'endDate',
        reason: `单次查询范围不得超过 ${MAX_QUERY_DAYS} 天（成本护栏）`,
      });
    }

    // 产线别名解析：规范编号 → 数据库实际名称集合
    let prodLines: string[] | null = null;
    let unknownProdLineReason: string | null = null;
    if (prodLine) {
      if (normalizeLineCode(prodLine) === '未分配') {
        // “未分配”保持既有特殊语义（NULL/空串/字面值）
        prodLines = null;
      } else {
        prodLines = await this.resolveProdLineValues(prodLine);
        if (prodLines.length === 0) {
          unknownProdLineReason =
            `产线「${prodLine}」在现有数据中不存在对应记录（含常见别名），未查询任何数据；` +
            '不扩大为全厂查询。';
        }
      }
    }

    if (unknownProdLineReason) {
      return {
        columns: [],
        rows: [],
        sources: [],
        planInsufficientReason: null,
        unknownProdLineReason,
      };
    }

    if (metric === 'defectQty') {
      return this.queryDefects(groupBy, startDate, endDate, prodLine, prodLines);
    }
    if (metric === 'deviceStatus') {
      return this.queryDevices(prodLine, prodLines);
    }
    return this.queryProductionMetrics(
      metric,
      groupBy,
      startDate,
      endDate,
      prodLine,
      prodLines,
      snapshotAt,
      metricsService,
    );
  }

  /**
   * 产线别名解析（S9 审查 P2-1）。
   *
   * 规则：取 `work_task` 与 `device` 中实际出现的产线名称，按
   * 「去首尾空白 + 去尾部『线』 + 大写」规范化后与规范编号比较。
   * 例：`SMT-2线` ↔ `SMT-2`、`smt-2` ↔ `SMT-2`。
   */
  private async resolveProdLineValues(prodLine: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `
      SELECT DISTINCT prod_line AS prod_line
      FROM work_task
      WHERE prod_line IS NOT NULL AND prod_line <> ''
      UNION
      SELECT DISTINCT prod_line AS prod_line
      FROM device
      WHERE prod_line IS NOT NULL AND prod_line <> ''
    `,
      [],
    )) as Array<{ prod_line: unknown }>;

    const canonical = normalizeLineCode(prodLine);
    const matched = Array.from(
      new Set(
        rows
          .map((r) => String(r.prod_line))
          .filter((actual) => normalizeLineCode(actual) === canonical),
      ),
    );
    return matched;
  }

  // ---------------------------------------------------------------- 报工/工单指标

  private async queryProductionMetrics(
    metric: QueryMetric,
    groupBy: QueryGroupBy,
    startDate: string,
    endDate: string,
    prodLine: string | null,
    prodLines: string[] | null,
    snapshotAt: string,
    metricsService: MetricsAggregationService,
  ): Promise<ControlledQueryResult> {
    const rows: QueryRow[] = [];
    let planInsufficientReason: string | null = null;
    // 别名解析后的实际名称集合进入 S7 聚合服务（IN 过滤），保持同源口径
    const scope = {
      startDate,
      endDate,
      ...(prodLines && prodLines.length > 0
        ? { prodLines }
        : prodLine
          ? { prodLine }
          : {}),
    };

    if (groupBy === 'prodLine') {
      const res = await metricsService.getProductionMetrics({ ...scope } as any, snapshotAt);
      if (metric === 'completionRate') {
        if (res.metrics.calculationStatus === 'insufficient_data') {
          planInsufficientReason =
            '所选范围内存在计划起止日期缺失或非法的工单，无法计算累计完成率（insufficient_data）';
        }
        for (const line of res.lines) {
          rows.push({
            prodLine: line.prodLine,
            planQty: line.planQty,
            doneQty: line.doneQty,
            planTotalQty: line.planTotalQty,
            completionRate: line.completionRate,
            dataStatus: line.completionRate !== null ? 'available' : 'no_data',
          });
        }
      } else {
        for (const line of res.lines) {
          rows.push(this.buildQuantityRow('prodLine', line.prodLine, metric, line));
        }
      }
    } else {
      // groupBy = date：逐日查询，每天按各自实际工单集合与截止时刻计算
      for (const day of listDays(startDate, endDate)) {
        const res = await metricsService.getProductionMetrics(
          { ...scope, startDate: day, endDate: day } as any,
          snapshotAt,
        );
        const status = res.metrics.calculationStatus;
        if (metric === 'completionRate') {
          if (status === 'insufficient_data' && !planInsufficientReason) {
            planInsufficientReason =
              '所选范围内存在计划起止日期缺失或非法的工单，无法计算累计完成率（insufficient_data）';
          }
          const available = status === 'available' && res.metrics.planTotalQty > 0;
          rows.push({
            date: day,
            planQty: res.metrics.planQty,
            doneQty: res.metrics.doneQty,
            planTotalQty: res.metrics.planTotalQty,
            completionRate: available ? res.metrics.completionRate : null,
            dataStatus:
              status === 'insufficient_data'
                ? 'insufficient_data'
                : available
                  ? 'available'
                  : 'no_data',
          });
        } else {
          rows.push(this.buildQuantityRow('date', day, metric, res.metrics));
        }
      }
    }

    const columns = this.buildProductionColumns(metric, groupBy);
    const sources: QuerySource[] =
      metric === 'completionRate'
        ? [
            {
              resource: 'work-orders',
              filters: {
                startDate,
                endDate,
                ...(prodLine ? { prodLine } : {}),
              },
            },
          ]
        : [
            {
              resource: 'reports',
              filters: {
                startDate,
                endDate,
                finalTasksOnly: true,
                ...(prodLine ? { prodLine } : {}),
              },
            },
          ];

    return { columns, rows, sources, planInsufficientReason, unknownProdLineReason: null };
  }

  private buildQuantityRow(
    dimKey: 'date' | 'prodLine',
    dimValue: string,
    metric: QueryMetric,
    values: {
      outputQty: number;
      goodQty: number;
      badQty: number;
      goodRate: number | null;
    },
  ): QueryRow {
    // 没有报工 → null + no_data；已确认真实为 0 才用 0（契约 §7.1）
    const available = values.outputQty > 0;
    const row: QueryRow = {
      [dimKey]: dimValue,
      dataStatus: available ? 'available' : 'no_data',
    };
    if (metric === 'goodRate') {
      row.goodRate = available ? values.goodRate : null;
    } else {
      row[metric] = available ? (values as any)[metric] : null;
    }
    return row;
  }

  private buildProductionColumns(metric: QueryMetric, groupBy: QueryGroupBy): QueryColumn[] {
    const dim: QueryColumn = { key: groupBy, label: QUERY_DIM_LABELS[groupBy], type: 'string' };
    if (metric === 'completionRate') {
      // 契约 §7.1：完成率 rows 必须包含 doneQty/planTotalQty/completionRate，日计划同返 planQty
      return [
        dim,
        { key: 'planQty', label: '日计划', type: 'number', unit: '件' },
        { key: 'doneQty', label: '累计良品', type: 'number', unit: '件' },
        { key: 'planTotalQty', label: '计划总数', type: 'number', unit: '件' },
        { key: 'completionRate', label: QUERY_METRIC_LABELS.completionRate.label, type: 'number', unit: '%' },
      ];
    }
    const { label, unit } = QUERY_METRIC_LABELS[metric];
    return [dim, { key: metric, label, type: 'number', ...(unit ? { unit } : {}) }];
  }

  // ---------------------------------------------------------------- 不良类型聚合

  private async queryDefects(
    groupBy: QueryGroupBy,
    startDate: string,
    endDate: string,
    prodLine: string | null,
    prodLines: string[] | null,
  ): Promise<ControlledQueryResult> {
    // 检验记录只能按 qc_record.task_id 推断产线；无 task 的检验不推断（契约 §6.5）
    const windowStart = `${startDate} 00:00:00`;
    const windowEnd = `${nextDayDateOnly(endDate)} 00:00:00`;
    const params: unknown[] = [windowStart, windowEnd];
    let lineJoin = 'LEFT JOIN work_task t ON q.task_id = t.id';
    let lineFilter = '';
    // 产线过滤一律用**别名解析后的实际名称集合**（S9 审查 P2-1）
    const lineValues = prodLines && prodLines.length > 0 ? prodLines : prodLine ? [prodLine] : [];
    if (lineValues.length > 0) {
      lineJoin = 'JOIN work_task t ON q.task_id = t.id';
      const placeholders = lineValues.map(() => '?').join(',');
      lineFilter = ` AND t.prod_line IN (${placeholders})`;
      params.push(...lineValues);
    }

    let groupExpr: string;
    let orderBy: string;
    if (groupBy === 'defectType') {
      groupExpr = 'd.defect_type';
      orderBy = 'qty DESC, d.defect_type ASC';
    } else if (groupBy === 'prodLine') {
      groupExpr = `COALESCE(NULLIF(t.prod_line, ''), '未分配')`;
      orderBy = 'qty DESC, prod_line ASC';
    } else {
      groupExpr = `DATE_FORMAT(q.checked_at, '%Y-%m-%d')`;
      orderBy = 'group_key ASC';
    }

    const sql = `
      SELECT ${groupExpr} AS group_key, SUM(d.qty) AS qty
      FROM defect d
      JOIN qc_record q ON d.qc_record_id = q.id
      ${lineJoin}
      WHERE q.checked_at >= ? AND q.checked_at < ?${lineFilter}
      GROUP BY group_key
      ORDER BY ${orderBy}
      LIMIT 50
    `;

    const rawRows = (await this.dataSource.query(sql, params)) as Array<{
      group_key: unknown;
      qty: unknown;
    }>;

    const metricLabel = QUERY_METRIC_LABELS.defectQty;
    const dimColumn: QueryColumn = {
      key: groupBy,
      label: QUERY_DIM_LABELS[groupBy],
      type: 'string',
    };
    const columns: QueryColumn[] = [
      dimColumn,
      { key: 'defectQty', label: metricLabel.label, type: 'number', unit: metricLabel.unit },
    ];

    let rows: QueryRow[];
    if (groupBy === 'date') {
      // 逐日补齐：没有不良记录的日期显式 null + no_data
      const byDay = new Map<string, number>();
      for (const r of rawRows) {
        byDay.set(String(r.group_key), Number(r.qty));
      }
      rows = listDays(startDate, endDate).map((day) => {
        const value = byDay.get(day);
        return {
          date: day,
          defectQty: value === undefined ? null : value,
          dataStatus: value === undefined ? 'no_data' : 'available',
        };
      });
    } else {
      rows = rawRows.map((r) => ({
        [groupBy]: String(r.group_key),
        defectQty: Number(r.qty),
        dataStatus: 'available',
      }));
    }

    return {
      columns,
      rows,
      sources: [
        {
          resource: 'defects',
          filters: {
            startDate,
            endDate,
            ...(prodLine ? { prodLine } : {}),
          },
        },
      ],
      planInsufficientReason: null,
      unknownProdLineReason: null,
    };
  }

  // ---------------------------------------------------------------- 设备当前状态

  private async queryDevices(
    prodLine: string | null,
    prodLines: string[] | null,
  ): Promise<ControlledQueryResult> {
    // deviceStatus 为**当前快照**指标（白名单仅 list），不使用日期窗口
    const params: unknown[] = [];
    let where = '';
    const lineValues = prodLines && prodLines.length > 0 ? prodLines : prodLine ? [prodLine] : [];
    if (lineValues.length > 0) {
      const placeholders = lineValues.map(() => '?').join(',');
      where = `WHERE prod_line IN (${placeholders})`;
      params.push(...lineValues);
    }
    const sql = `
      SELECT code, name, prod_line, status
      FROM device
      ${where}
      ORDER BY code ASC
      LIMIT 100
    `;
    const rawRows = (await this.dataSource.query(sql, params)) as Array<{
      code: string;
      name: string;
      prod_line: string | null;
      status: string;
    }>;

    const columns: QueryColumn[] = [
      { key: 'device', label: '设备', type: 'string' },
      { key: 'deviceName', label: '设备名称', type: 'string' },
      { key: 'prodLine', label: '产线', type: 'string' },
      { key: 'deviceStatus', label: QUERY_METRIC_LABELS.deviceStatus.label, type: 'string' },
    ];
    const rows: QueryRow[] = rawRows.map((r) => ({
      device: r.code,
      deviceName: r.name,
      prodLine: r.prod_line ?? '未分配',
      deviceStatus: r.status,
      dataStatus: 'available',
    }));

    return {
      columns,
      rows,
      sources: [
        {
          resource: 'devices',
          filters: prodLine ? { prodLine } : {},
        },
      ],
      planInsufficientReason: null,
      unknownProdLineReason: null,
    };
  }
}

// ---------------------------------------------------------------- 纯函数辅助

/**
 * 产线编号规范化（S9 审查 P2-1）：去首尾空白、去尾部「线」、转大写。
 * 例：`SMT-2线` / `smt-2` / `SMT-2` → `SMT-2`。
 */
export function normalizeLineCode(value: string): string {
  return value.trim().replace(/线+$/, '').toUpperCase();
}

/**
 * 问题中是否包含**显式日期表述**（契约 §7.1「显式参数与自然语言范围冲突」判定用）。
 *
 * 意图解析对无日期词语的问题会默认今天，NestJS 无法从 intent 区分「默认今天」与
 * 「问题说了今天」；因此这里用保守正则识别显式日期线索：
 * - 命中且与显式参数不一致 → 10001 要求重述（冲突）；
 * - 未命中 → 显式参数视为用户对查询范围的补充声明（不构成冲突）。
 *
 * 宁可误判为「有线索」（多一次 10001），不静默改写用户已明示的范围。
 */
const EXPLICIT_DATE_HINT_RE = new RegExp(
  [
    '\\d{4}-\\d{2}-\\d{2}',
    '\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日',
    '今天|今日|昨天|昨日|前天|本星期|本周|这周',
    '(?:近|最近|过去)\\s*\\d{1,3}\\s*天',
    '\\d{1,3}\\s*天前',
    '\\d+\\s*天',
  ].join('|'),
);

export function hasExplicitDateHint(question: string): boolean {
  return EXPLICIT_DATE_HINT_RE.test(question);
}

function countDays(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

/** 生成闭区间 [startDate, endDate] 内的日期列表（升序） */
export function listDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (compareDateOnly(cursor, endDate) <= 0 && guard < 400) {
    days.push(cursor);
    cursor = nextDayDateOnly(cursor);
    guard += 1;
  }
  return days;
}
