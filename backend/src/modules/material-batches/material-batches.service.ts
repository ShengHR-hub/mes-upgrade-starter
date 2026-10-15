import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { isValidDateOnly, nextDayDateOnly } from '../../common/utils/date-only.util.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { isDuplicateKeyError } from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';

import type { CreateMaterialBatchDto } from './dto/create-material-batch.dto.js';
import type { ListMaterialBatchesQueryDto } from './dto/list-material-batches-query.dto.js';
import type { MaterialBatchResponse } from './dto/material-batch-response.js';

interface BatchRow {
  id: string;
  batch_no: string;
  material_code: string;
  qty: number;
  inbound_at: Date | string | null;
  supplier: string | null;
}

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

/**
 * B5 物料批次服务 —— 契约 §6.6。
 *
 * 边界（契约 §6.6 / §10.1）：
 * - `qty` 只表示**入库数量**；没有出库、占用、调整 API，不推导可用库存；
 * - `batchNo` 唯一：先查重 + 捕获 ER_DUP_ENTRY(1062) 转 30002，不把唯一键冲突透传 500；
 * - 入库与审计**同一事务**提交或回滚；
 * - `GET /material-batches/{id}/sn-traces` 是批次反查（B6 关联读取）。
 */
@Injectable()
export class MaterialBatchesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListMaterialBatchesQueryDto): Promise<PageResult<MaterialBatchResponse>> {
    const pagination = normalizePagination(query);

    if (query.inboundDateFrom !== undefined && !isValidDateOnly(query.inboundDateFrom)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'inboundDateFrom', reason: '必须为真实存在的日期 YYYY-MM-DD' }],
      });
    }
    if (query.inboundDateTo !== undefined && !isValidDateOnly(query.inboundDateTo)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'inboundDateTo', reason: '必须为真实存在的日期 YYYY-MM-DD' }],
      });
    }
    if (
      query.inboundDateFrom !== undefined &&
      query.inboundDateTo !== undefined &&
      query.inboundDateFrom > query.inboundDateTo
    ) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'inboundDateFrom', reason: '起始日期不得晚于结束日期' }],
      });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.materialCode !== undefined) {
      conditions.push('mb.material_code = ?');
      params.push(query.materialCode);
    }
    if (query.batchNo !== undefined) {
      // 批次号是精确匹配而不是模糊搜索：避免把相似批次号当追溯结果
      conditions.push('mb.batch_no = ?');
      params.push(query.batchNo);
    }
    // 半开区间：结束日 + 1 天 00:00（与 S7 历史查询统一口径，防边界漏算）
    if (query.inboundDateFrom !== undefined) {
      conditions.push('mb.inbound_at >= ?');
      params.push(query.inboundDateFrom);
    }
    if (query.inboundDateTo !== undefined) {
      conditions.push('mb.inbound_at < ?');
      params.push(nextDayDateOnly(query.inboundDateTo));
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM material_batch mb ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT mb.id AS id, mb.batch_no AS batch_no, mb.material_code AS material_code,',
        'mb.qty AS qty, DATE_FORMAT(mb.inbound_at, ?) AS inbound_at, mb.supplier AS supplier',
        `FROM material_batch mb ${whereSql} ORDER BY mb.id ASC LIMIT ? OFFSET ?`,
      ].join(' '),
      ['%Y-%m-%d', ...params, pagination.take, pagination.skip],
    )) as BatchRow[];

    return buildPage(
      rows.map((row) => this.toResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /**
   * 批次入库（契约 §6.6 `POST /material-batches`）。
   *
   * 同一事务：查重物料存在性 → 插入批次 → 写审计。任一步失败整体回滚。
   */
  async create(
    dto: CreateMaterialBatchDto,
    context: { userId: string; ip: string | null },
  ): Promise<MaterialBatchResponse> {
    if (!isValidDateOnly(dto.inboundAt)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'inboundAt', reason: '必须为真实存在的日期 YYYY-MM-DD' }],
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const materials = (await manager.query(
        'SELECT code FROM material WHERE code = ? FOR UPDATE',
        [dto.materialCode],
      )) as Array<{ code: string }>;
      if (materials.length === 0) {
        throw new BusinessException(
          ErrorCode.INVALID_REFERENCE,
          `物料不存在：${dto.materialCode}`,
        );
      }

      const existing = (await manager.query(
        'SELECT id FROM material_batch WHERE batch_no = ?',
        [dto.batchNo],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        throw new BusinessException(
          ErrorCode.RESOURCE_CONFLICT,
          `批次号已存在：${dto.batchNo}`,
        );
      }

      let insertId: string;
      try {
        const result = (await manager.query(
          [
            'INSERT INTO material_batch (batch_no, material_code, qty, inbound_at, supplier)',
            'VALUES (?, ?, ?, ?, ?)',
          ].join(' '),
          [dto.batchNo, dto.materialCode, dto.qty, dto.inboundAt, dto.supplier ?? null],
        )) as { insertId: string | number };
        insertId = String(result.insertId);
      } catch (error) {
        // 并发下唯一键冲突：转业务码，不透传 500（S5 教训：唯一键冲突转业务码）
        if (isDuplicateKeyError(error)) {
          throw new BusinessException(
            ErrorCode.RESOURCE_CONFLICT,
            `批次号已存在：${dto.batchNo}`,
          );
        }
        throw error;
      }

      await this.audit.write(manager, {
        userId: context.userId,
        action: '批次入库',
        target: `material_batch:${insertId}`,
        detail: `批次 ${dto.batchNo} 入库物料 ${dto.materialCode}，数量 ${dto.qty}`,
        ip: context.ip,
      });

      const rows = (await manager.query(
        [
          'SELECT mb.id AS id, mb.batch_no AS batch_no, mb.material_code AS material_code,',
          "mb.qty AS qty, DATE_FORMAT(mb.inbound_at, '%Y-%m-%d') AS inbound_at, mb.supplier AS supplier",
          'FROM material_batch mb WHERE mb.id = ?',
        ].join(' '),
        [insertId],
      )) as BatchRow[];

      return this.toResponse(rows[0]);
    });
  }

  /**
   * 批次反查：绑定该批次的 SN 列表（契约 §6.6 `GET /material-batches/{id}/sn-traces`）。
   *
   * SN 一个批次一条记录；反查结果是**精确批次匹配**，不是模糊追溯。
   */
  async listSnTraces(batchId: string, query: ListMaterialBatchesQueryDto): Promise<PageResult<unknown>> {
    if (!isValidDecimalId(batchId)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'id', reason: '批次 ID 必须为正整数且不超过 BIGINT 上限' }],
      });
    }
    const pagination = normalizePagination(query);

    const batch = (await this.dataSource.query(
      'SELECT id FROM material_batch WHERE id = ?',
      [batchId],
    )) as Array<{ id: string }>;
    if (batch.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `物料批次不存在：${batchId}`);
    }

    const countRows = (await this.dataSource.query(
      'SELECT COUNT(*) AS total FROM sn_trace WHERE batch_id = ?',
      [batchId],
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT st.id AS id, st.sn AS sn, st.work_order_id AS work_order_id,',
        'st.product_code AS product_code, st.task_id AS task_id, st.operator_id AS operator_id,',
        'st.device_code AS device_code, st.batch_id AS batch_id, st.qc_result AS qc_result,',
        'st.produced_at AS produced_at',
        'FROM sn_trace st WHERE st.batch_id = ? ORDER BY st.id ASC LIMIT ? OFFSET ?',
      ].join(' '),
      [batchId, pagination.take, pagination.skip],
    )) as SnTraceRow[];

    return buildPage(
      rows.map((row) => ({
        id: row.id,
        sn: row.sn,
        workOrderId: row.work_order_id,
        productCode: row.product_code,
        taskId: row.task_id,
        operatorId: row.operator_id,
        deviceCode: row.device_code,
        batchId: row.batch_id,
        qcResult: row.qc_result,
        producedAt: row.produced_at,
        ...DEMO_SOURCE_META,
      })),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  private toResponse(row: BatchRow): MaterialBatchResponse {
    return {
      id: String(row.id),
      batchNo: row.batch_no,
      materialCode: row.material_code,
      qty: Number(row.qty),
      inboundAt:
        typeof row.inbound_at === 'string'
          ? row.inbound_at
          : row.inbound_at === null
            ? null
            : row.inbound_at.toISOString().slice(0, 10),
      supplier: row.supplier,
      ...DEMO_SOURCE_META,
    };
  }
}
