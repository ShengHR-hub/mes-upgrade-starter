import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { isDuplicateKeyError } from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';

import type {
  CreateSnTraceDto,
  ListSnTracesQueryDto,
  UpdateSnTraceDto,
} from './dto/sn-trace.dto.js';
import type {
  SnTraceDetailResponse,
  SnTraceExportResponse,
  SnTraceResponse,
} from './dto/sn-trace-response.js';
import { SN_TRACE_LIMITATIONS } from './dto/sn-trace-response.js';

interface SnTraceRow {
  id: string;
  sn: string;
  work_order_id: string;
  product_code: string;
  task_id: string | null;
  operator_id: string | null;
  device_code: string | null;
  batch_id: string | null;
  qc_result: string | null;
  produced_at: Date | null;
}

const SN_COLUMNS = [
  'st.id AS id',
  'st.sn AS sn',
  'st.work_order_id AS work_order_id',
  'st.product_code AS product_code',
  'st.task_id AS task_id',
  'st.operator_id AS operator_id',
  'st.device_code AS device_code',
  'st.batch_id AS batch_id',
  'st.qc_result AS qc_result',
  'st.produced_at AS produced_at',
].join(', ');

/**
 * B6 SN 追溯服务 —— 契约 §6.6。
 *
 * 单快照硬约束：
 * - `sn` 唯一；一个 SN 仅有一个当前快照及一个批次；
 * - 创建时 `productCode` 从工单读取、`operatorId` 取服务端可信身份；
 * - `taskId` 必须属于对应工单（10002）；`deviceCode` / `batchId` 必须存在；
 * - PATCH 不修改 `produced_at`，不伪造过去事件；
 * - 详情/导出保留 coverage 与 limitations，不宣称逐工序已证实历史或 IATF 16949 合规。
 */
@Injectable()
export class SnTracesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/v1/sn-traces —— 列表（sn 精确匹配） */
  async list(query: ListSnTracesQueryDto): Promise<PageResult<SnTraceResponse>> {
    const pagination = normalizePagination(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.sn !== undefined) {
      // 精确匹配：不用模糊结果冒充唯一追溯（契约 §6.6）
      conditions.push('st.sn = ?');
      params.push(query.sn);
    }
    if (query.workOrderId !== undefined) {
      conditions.push('st.work_order_id = ?');
      params.push(query.workOrderId);
    }
    if (query.batchId !== undefined) {
      conditions.push('st.batch_id = ?');
      params.push(query.batchId);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM sn_trace st ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      `SELECT ${SN_COLUMNS} FROM sn_trace st ${whereSql} ORDER BY st.id ASC LIMIT ? OFFSET ?`,
      [...params, pagination.take, pagination.skip],
    )) as SnTraceRow[];

    return buildPage(
      rows.map((row) => this.toResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** POST /api/v1/sn-traces —— 创建 SN 快照（201） */
  async create(
    dto: CreateSnTraceDto,
    context: { userId: string; ip: string | null },
  ): Promise<SnTraceResponse> {
    return this.dataSource.transaction(async (manager) => {
      const workOrders = (await manager.query(
        'SELECT id, product_code FROM work_order WHERE id = ?',
        [dto.workOrderId],
      )) as Array<{ id: string; product_code: string }>;
      if (workOrders.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工单不存在：${dto.workOrderId}`);
      }
      const workOrder = workOrders[0];

      if (dto.taskId !== undefined) {
        // task 必须属于对应工单（契约 §6.6；10002）
        const tasks = (await manager.query(
          'SELECT id FROM work_task WHERE id = ? AND work_order_id = ?',
          [dto.taskId, dto.workOrderId],
        )) as Array<{ id: string }>;
        if (tasks.length === 0) {
          throw new BusinessException(
            ErrorCode.INVALID_REFERENCE,
            '工序任务不存在或不属于该工单',
          );
        }
      }
      if (dto.deviceCode !== undefined) {
        const devices = (await manager.query('SELECT code FROM device WHERE code = ?', [
          dto.deviceCode,
        ])) as Array<{ code: string }>;
        if (devices.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, `设备不存在：${dto.deviceCode}`);
        }
      }
      if (dto.batchId !== undefined) {
        const batches = (await manager.query('SELECT id FROM material_batch WHERE id = ?', [
          dto.batchId,
        ])) as Array<{ id: string }>;
        if (batches.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, `物料批次不存在：${dto.batchId}`);
        }
      }

      const duplicated = (await manager.query('SELECT id FROM sn_trace WHERE sn = ?', [
        dto.sn,
      ])) as Array<{ id: string }>;
      if (duplicated.length > 0) {
        throw new BusinessException(ErrorCode.RESOURCE_CONFLICT, `SN 已存在：${dto.sn}`);
      }

      let insertId: string;
      try {
        const result = (await manager.query(
          [
            'INSERT INTO sn_trace (sn, work_order_id, product_code, task_id, operator_id,',
            'device_code, batch_id, qc_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ].join(' '),
          [
            dto.sn,
            dto.workOrderId,
            workOrder.product_code,
            dto.taskId ?? null,
            // operatorId 来自可信认证身份，不接受客户端指定（契约 §6.6）
            context.userId,
            dto.deviceCode ?? null,
            dto.batchId ?? null,
            dto.qcResult ?? null,
          ],
        )) as { insertId: string | number };
        insertId = String(result.insertId);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new BusinessException(ErrorCode.RESOURCE_CONFLICT, `SN 已存在：${dto.sn}`);
        }
        throw error;
      }

      await this.audit.write(manager, {
        userId: context.userId,
        action: '创建SN追溯',
        target: `sn_trace:${dto.sn}`,
        detail: `SN ${dto.sn} 关联工单 ${dto.workOrderId}，产品 ${workOrder.product_code}`,
        ip: context.ip,
      });

      const rows = (await manager.query(
        `SELECT ${SN_COLUMNS} FROM sn_trace st WHERE st.id = ?`,
        [insertId],
      )) as SnTraceRow[];
      return this.toResponse(rows[0]);
    });
  }

  /** PATCH /api/v1/sn-traces/{sn} —— 更新当前快照（不改 producedAt） */
  async update(
    sn: string,
    dto: UpdateSnTraceDto,
    context: { userId: string; ip: string | null },
  ): Promise<SnTraceResponse> {
    const hasChange =
      dto.taskId !== undefined ||
      dto.deviceCode !== undefined ||
      dto.batchId !== undefined ||
      dto.qcResult !== undefined;
    if (!hasChange) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [
          {
            field: 'body',
            reason: '至少提供一个待修改字段（taskId / deviceCode / batchId / qcResult）',
          },
        ],
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT ${SN_COLUMNS} FROM sn_trace st WHERE st.sn = ? FOR UPDATE`,
        [sn],
      )) as SnTraceRow[];
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `SN 不存在：${sn}`);
      }
      const current = rows[0];

      if (dto.taskId !== undefined) {
        const tasks = (await manager.query(
          'SELECT id FROM work_task WHERE id = ? AND work_order_id = ?',
          [dto.taskId, current.work_order_id],
        )) as Array<{ id: string }>;
        if (tasks.length === 0) {
          throw new BusinessException(
            ErrorCode.INVALID_REFERENCE,
            '工序任务不存在或不属于该工单',
          );
        }
      }
      if (dto.deviceCode !== undefined) {
        const devices = (await manager.query('SELECT code FROM device WHERE code = ?', [
          dto.deviceCode,
        ])) as Array<{ code: string }>;
        if (devices.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, `设备不存在：${dto.deviceCode}`);
        }
      }
      if (dto.batchId !== undefined) {
        const batches = (await manager.query('SELECT id FROM material_batch WHERE id = ?', [
          dto.batchId,
        ])) as Array<{ id: string }>;
        if (batches.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, `物料批次不存在：${dto.batchId}`);
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (dto.taskId !== undefined) {
        sets.push('task_id = ?');
        params.push(dto.taskId);
      }
      if (dto.deviceCode !== undefined) {
        sets.push('device_code = ?');
        params.push(dto.deviceCode);
      }
      if (dto.batchId !== undefined) {
        sets.push('batch_id = ?');
        params.push(dto.batchId);
      }
      if (dto.qcResult !== undefined) {
        sets.push('qc_result = ?');
        params.push(dto.qcResult);
      }
      params.push(sn);
      // ⚠️ 不更新 produced_at —— 不伪造过去事件（契约 §6.6）
      await manager.query(`UPDATE sn_trace SET ${sets.join(', ')} WHERE sn = ?`, params);

      await this.audit.write(manager, {
        userId: context.userId,
        action: '更新SN快照',
        target: `sn_trace:${sn}`,
        detail: `SN ${sn} 当前快照已更新`,
        ip: context.ip,
      });

      const updated = (await manager.query(
        `SELECT ${SN_COLUMNS} FROM sn_trace st WHERE st.sn = ?`,
        [sn],
      )) as SnTraceRow[];
      return this.toResponse(updated[0]);
    });
  }

  /**
   * GET /api/v1/sn-traces/{sn} —— 详情（单快照 + 工单级关联上下文）。
   *
   * 上下文仅包含该工单的任务与检验记录，**仅作参考**：不展示为该 SN 已证实的
   * 逐工序、逐件检验历史。coverage / limitations 固定返回，不得删除。
   */
  async detail(sn: string): Promise<SnTraceDetailResponse> {
    const rows = (await this.dataSource.query(
      `SELECT ${SN_COLUMNS} FROM sn_trace st WHERE st.sn = ?`,
      [sn],
    )) as SnTraceRow[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `SN 不存在：${sn}`);
    }
    const trace = rows[0];

    const tasks = (await this.dataSource.query(
      [
        'SELECT wt.id AS id, wt.work_order_id AS workOrderId, wt.seq AS seq,',
        'wt.step_name AS stepName, wt.workshop AS workshop, wt.prod_line AS prodLine,',
        'wt.device_code AS deviceCode, wt.operator_id AS operatorId, wt.plan_qty AS planQty,',
        'wt.good_qty AS goodQty, wt.bad_qty AS badQty, wt.status AS status,',
        'wt.plan_start AS planStart, wt.plan_end AS planEnd, wt.started_at AS startedAt,',
        'wt.finished_at AS finishedAt',
        'FROM work_task wt WHERE wt.work_order_id = ? ORDER BY wt.seq ASC',
      ].join(' '),
      [trace.work_order_id],
    )) as Array<Record<string, unknown>>;

    const inspections = (await this.dataSource.query(
      [
        'SELECT qc.id AS id, qc.work_order_id AS workOrderId, qc.task_id AS taskId,',
        "qc.result AS result, qc.check_qty AS checkQty, qc.ng_qty AS ngQty,",
        'qc.inspector_id AS inspectorId, qc.checked_at AS checkedAt, qc.remark AS remark',
        'FROM qc_record qc WHERE qc.work_order_id = ? ORDER BY qc.id DESC',
      ].join(' '),
      [trace.work_order_id],
    )) as Array<Record<string, unknown>>;

    return {
      trace: this.toResponse(trace),
      context: { tasks, inspections },
      coverage: 'single-snapshot-with-work-order-context',
      limitations: [...SN_TRACE_LIMITATIONS],
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * POST /api/v1/sn-traces/{sn}/exports —— JSON 追溯导出（契约 §6.6；Q7 边界）。
   *
   * - 只支持 `format:"json"`；内容为字符串化 JSON（业务 API 仍走统一包体，前端下载为文件）；
   * - 文件名由 SN 安全化生成（仅保留 `[A-Za-z0-9._-]`，截断长度），不含账号敏感信息；
   * - 内容保留 coverage / limitations / dataSource，不宣称 IATF 16949 合规。
   */
  async export(sn: string, format: string): Promise<SnTraceExportResponse> {
    if (format !== 'json') {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'format', reason: '本版仅支持 format="json"' }],
      });
    }

    const detail = await this.detail(sn);
    const payload = {
      sn: detail.trace.sn,
      productCode: detail.trace.productCode,
      workOrderId: detail.trace.workOrderId,
      taskId: detail.trace.taskId,
      deviceCode: detail.trace.deviceCode,
      batchId: detail.trace.batchId,
      qcResult: detail.trace.qcResult,
      producedAt: detail.trace.producedAt,
      context: detail.context,
      coverage: detail.coverage,
      limitations: detail.limitations,
      dataSource: detail.dataSource,
      dataLabel: detail.dataLabel,
    };

    return {
      fileName: `${safeFileNameSegment(sn)}-trace.json`,
      mediaType: 'application/json',
      content: JSON.stringify(payload),
      coverage: detail.coverage,
      ...DEMO_SOURCE_META,
    };
  }

  private toResponse(row: SnTraceRow): SnTraceResponse {
    return {
      id: String(row.id),
      sn: row.sn,
      workOrderId: String(row.work_order_id),
      productCode: row.product_code,
      taskId: row.task_id === null ? null : String(row.task_id),
      operatorId: row.operator_id === null ? null : String(row.operator_id),
      deviceCode: row.device_code,
      batchId: row.batch_id === null ? null : String(row.batch_id),
      qcResult: row.qc_result,
      producedAt: row.produced_at === null ? null : toShanghaiRfc3339(row.produced_at),
      ...DEMO_SOURCE_META,
    };
  }
}

/**
 * 导出文件名安全化：仅保留 `[A-Za-z0-9._-]`，其余替换为 `_`，并截断长度。
 * 不包含用户名、口令、令牌等账号敏感信息。
 */
export function safeFileNameSegment(sn: string): string {
  const safe = sn.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '');
  const trimmed = safe.length > 0 ? safe.slice(0, 64) : 'sn';
  return trimmed.length > 0 ? trimmed : 'sn';
}
