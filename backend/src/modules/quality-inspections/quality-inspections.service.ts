import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import {
  compareDateOnly,
  isValidDateOnly,
  nextDayDateOnly,
} from '../../common/utils/date-only.util.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';

import { CreateQualityInspectionDto, MAX_INT } from './dto/create-quality-inspection.dto.js';
import type { ListDefectsQueryDto } from './dto/list-defects-query.dto.js';
import type { ListQualityInspectionsQueryDto } from './dto/list-quality-inspections-query.dto.js';

export interface DefectItemResponse {
  id: string;
  defectType: string;
  qty: number;
  stepName: string | null;
  description: string | null;
}

export interface InspectionResponse {
  id: string;
  workOrderId: string;
  taskId: string | null;
  result: 'OK' | 'NG';
  checkQty: number;
  ngQty: number;
  inspectorId: string | null;
  checkedAt: string | null;
  remark: string | null;
  defects?: DefectItemResponse[];
  dataSource: string;
  dataLabel: string;
}

export interface DefectResponse {
  id: string;
  qcRecordId: string;
  defectType: string;
  qty: number;
  stepName: string | null;
  description: string | null;
  createdAt: string | null;
  dataSource: string;
  dataLabel: string;
}

/**
 * B4 质量检验服务 —— 契约 §6.5。
 */
@Injectable()
export class QualityInspectionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateQualityInspectionDto,
    context: { userId: string; ip: string | null },
  ): Promise<InspectionResponse> {
    if (!isValidDecimalId(dto.workOrderId)) {
      throw invalidArgument({ field: 'workOrderId', reason: 'workOrderId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (dto.taskId !== undefined && !isValidDecimalId(dto.taskId)) {
      throw invalidArgument({ field: 'taskId', reason: 'taskId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (dto.checkQty <= 0) {
      throw invalidArgument({ field: 'checkQty', reason: 'checkQty 必须为正整数' });
    }
    if (dto.checkQty > MAX_INT) {
      throw invalidArgument({ field: 'checkQty', reason: `checkQty 不得超过 ${MAX_INT}` });
    }
    if (dto.ngQty < 0) {
      throw invalidArgument({ field: 'ngQty', reason: 'ngQty 不得小于 0' });
    }
    if (dto.ngQty > MAX_INT) {
      throw invalidArgument({ field: 'ngQty', reason: `ngQty 不得超过 ${MAX_INT}` });
    }
    if (dto.ngQty > dto.checkQty) {
      throw new BusinessException(ErrorCode.INVALID_QUANTITY, '不良数量不得大于送检数量');
    }

    if (dto.result === 'OK') {
      if (dto.ngQty !== 0) {
        throw new BusinessException(ErrorCode.INVALID_QUANTITY, 'OK结果的ngQty必须为0');
      }
      if (dto.defects && dto.defects.length > 0) {
        throw new BusinessException(ErrorCode.INVALID_QUANTITY, 'OK结果不得包含不良明细');
      }
    } else {
      if (dto.ngQty <= 0) {
        throw new BusinessException(ErrorCode.INVALID_QUANTITY, 'NG结果的ngQty必须大于0');
      }
      if (!dto.defects || dto.defects.length === 0) {
        throw new BusinessException(ErrorCode.INVALID_QUANTITY, 'NG结果必须提供至少一项不良明细');
      }
      const sum = dto.defects.reduce((acc, cur) => acc + cur.qty, 0);
      if (sum !== dto.ngQty) {
        throw new BusinessException(
          ErrorCode.INVALID_QUANTITY,
          `不良明细数量总和 (${sum}) 必须等于 ngQty (${dto.ngQty})`,
        );
      }
    }

    return this.dataSource.transaction(async (manager) => {
      // Validate workOrder
      const wos = (await manager.query('SELECT * FROM work_order WHERE id = ? FOR UPDATE', [
        dto.workOrderId,
      ])) as any[];
      if (wos.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工单不存在：${dto.workOrderId}`);
      }

      let stepName: string | null = null;
      // Validate task if provided
      if (dto.taskId) {
        const tasks = (await manager.query(
          'SELECT * FROM work_task WHERE id = ? FOR UPDATE',
          [dto.taskId],
        )) as any[];
        if (tasks.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, `关联任务不存在：${dto.taskId}`);
        }
        if (String(tasks[0].work_order_id) !== String(dto.workOrderId)) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '任务不属于所选工单');
        }
        stepName = tasks[0].step_name;
      }

      const insertResult = await manager.query(
        'INSERT INTO qc_record (work_order_id, task_id, result, check_qty, ng_qty, inspector_id, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          dto.workOrderId,
          dto.taskId || null,
          dto.result,
          dto.checkQty,
          dto.ngQty,
          context.userId,
          dto.remark || null,
        ],
      );
      const qcRecordId = insertResult.insertId;

      const createdDefects: DefectItemResponse[] = [];
      if (dto.result === 'NG' && dto.defects) {
        for (const defect of dto.defects) {
          const defResult = await manager.query(
            'INSERT INTO defect (qc_record_id, defect_type, qty, step_name, description) VALUES (?, ?, ?, ?, ?)',
            [qcRecordId, defect.defectType, defect.qty, stepName, defect.description || null],
          );
          createdDefects.push({
            id: String(defResult.insertId),
            defectType: defect.defectType,
            qty: defect.qty,
            stepName,
            description: defect.description || null,
          });
        }
      }

      await this.audit.write(manager, {
        userId: context.userId,
        action: '质量检验',
        target: `qc_record:${qcRecordId}`,
        detail: `工单 ${wos[0].code} 质检 ${dto.result}，送检 ${dto.checkQty}，不良 ${dto.ngQty}`,
        ip: context.ip,
      });

      const qcRow = (await manager.query(
        'SELECT r.*, UNIX_TIMESTAMP(r.checked_at) AS checked_at_epoch FROM qc_record r WHERE id = ?',
        [qcRecordId],
      )) as any[];

      const epoch = Number(qcRow[0].checked_at_epoch);
      const checkedAt = Number.isFinite(epoch) ? toShanghaiRfc3339(new Date(epoch * 1000)) : null;

      return {
        id: String(qcRecordId),
        workOrderId: String(dto.workOrderId),
        taskId: dto.taskId ? String(dto.taskId) : null,
        result: qcRow[0].result,
        checkQty: Number(qcRow[0].check_qty),
        ngQty: Number(qcRow[0].ng_qty),
        inspectorId: String(context.userId),
        checkedAt,
        remark: qcRow[0].remark ?? null,
        defects: createdDefects.length > 0 ? createdDefects : undefined,
        ...DEMO_SOURCE_META,
      };
    });
  }

  async findOne(rawId: string): Promise<InspectionResponse> {
    if (!isValidDecimalId(rawId)) {
      throw invalidArgument({ field: 'id', reason: 'id 必须为正整数且不超过 BIGINT 上限' });
    }

    const qcRows = (await this.dataSource.query(
      'SELECT r.*, UNIX_TIMESTAMP(r.checked_at) AS checked_at_epoch FROM qc_record r WHERE id = ?',
      [rawId],
    )) as any[];
    if (qcRows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `检验记录不存在：${rawId}`);
    }

    const r = qcRows[0];
    const defects = (await this.dataSource.query(
      'SELECT * FROM defect WHERE qc_record_id = ? ORDER BY id ASC',
      [r.id],
    )) as any[];

    const epoch = Number(r.checked_at_epoch);
    const checkedAt = Number.isFinite(epoch) ? toShanghaiRfc3339(new Date(epoch * 1000)) : null;

    const result: InspectionResponse = {
      id: String(r.id),
      workOrderId: String(r.work_order_id),
      taskId: r.task_id ? String(r.task_id) : null,
      result: r.result,
      checkQty: Number(r.check_qty),
      ngQty: Number(r.ng_qty),
      inspectorId: r.inspector_id ? String(r.inspector_id) : null,
      checkedAt,
      remark: r.remark ?? null,
      ...DEMO_SOURCE_META,
    };

    if (r.result === 'NG') {
      result.defects = defects.map((d: any) => ({
        id: String(d.id),
        defectType: d.defect_type,
        qty: Number(d.qty),
        stepName: d.step_name ?? null,
        description: d.description ?? null,
      }));
    }

    return result;
  }

  async list(query: ListQualityInspectionsQueryDto): Promise<PageResult<InspectionResponse>> {
    const pagination = normalizePagination(query);

    if (query.workOrderId !== undefined && !isValidDecimalId(query.workOrderId)) {
      throw invalidArgument({ field: 'workOrderId', reason: 'workOrderId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (query.taskId !== undefined && !isValidDecimalId(query.taskId)) {
      throw invalidArgument({ field: 'taskId', reason: 'taskId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (query.startDate !== undefined && !isValidDateOnly(query.startDate)) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 必须为真实存在的日期（YYYY-MM-DD）' });
    }
    if (query.endDate !== undefined && !isValidDateOnly(query.endDate)) {
      throw invalidArgument({ field: 'endDate', reason: 'endDate 必须为真实存在的日期（YYYY-MM-DD）' });
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

    if (query.workOrderId !== undefined) {
      conditions.push('r.work_order_id = ?');
      params.push(query.workOrderId);
    }
    if (query.taskId !== undefined) {
      conditions.push('r.task_id = ?');
      params.push(query.taskId);
    }
    if (query.result !== undefined) {
      conditions.push('r.result = ?');
      params.push(query.result);
    }
    if (query.startDate !== undefined) {
      conditions.push('r.checked_at >= ?');
      params.push(`${query.startDate} 00:00:00`);
    }
    if (query.endDate !== undefined) {
      const nextDay = nextDayDateOnly(query.endDate);
      conditions.push('r.checked_at < ?');
      params.push(`${nextDay} 00:00:00`);
    }
    if (query.prodLine !== undefined) {
      if (query.prodLine === '未分配') {
        conditions.push('(t.prod_line IS NULL OR t.prod_line = "" OR t.prod_line = "未分配")');
      } else {
        conditions.push('t.prod_line = ?');
        params.push(query.prodLine);
      }
    }
    if (query.workshop !== undefined) {
      if (query.workshop === '未分配') {
        conditions.push('(t.workshop IS NULL OR t.workshop = "" OR t.workshop = "未分配")');
      } else {
        conditions.push('t.workshop = ?');
        params.push(query.workshop);
      }
    }
    if (query.productCode !== undefined) {
      conditions.push('wo.product_code = ?');
      params.push(query.productCode);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const joinSql =
      'LEFT JOIN work_task t ON r.task_id = t.id LEFT JOIN work_order wo ON r.work_order_id = wo.id';

    const countQuery = `SELECT COUNT(*) AS total FROM qc_record r ${joinSql} ${whereSql}`;
    const rowsQuery = `
      SELECT r.*, UNIX_TIMESTAMP(r.checked_at) AS checked_at_epoch
      FROM qc_record r
      ${joinSql}
      ${whereSql}
      ORDER BY r.checked_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `;

    const countRows = (await this.dataSource.query(countQuery, params)) as any[];
    const total = Number(countRows[0]?.total ?? 0);

    const rows = (await this.dataSource.query(rowsQuery, [
      ...params,
      pagination.take,
      pagination.skip,
    ])) as any[];

    // Fetch related defects for NG inspections
    const ngIds = rows.filter((r) => r.result === 'NG').map((r) => r.id);
    const defectsMap: Record<string, DefectItemResponse[]> = {};

    if (ngIds.length > 0) {
      const placeholders = ngIds.map(() => '?').join(', ');
      const defRows = (await this.dataSource.query(
        `SELECT * FROM defect WHERE qc_record_id IN (${placeholders}) ORDER BY id ASC`,
        ngIds,
      )) as any[];
      for (const d of defRows) {
        const key = String(d.qc_record_id);
        if (!defectsMap[key]) defectsMap[key] = [];
        defectsMap[key].push({
          id: String(d.id),
          defectType: d.defect_type,
          qty: Number(d.qty),
          stepName: d.step_name ?? null,
          description: d.description ?? null,
        });
      }
    }

    const list: InspectionResponse[] = rows.map((r) => {
      const epoch = Number(r.checked_at_epoch);
      const res: InspectionResponse = {
        id: String(r.id),
        workOrderId: String(r.work_order_id),
        taskId: r.task_id ? String(r.task_id) : null,
        result: r.result,
        checkQty: Number(r.check_qty),
        ngQty: Number(r.ng_qty),
        inspectorId: r.inspector_id ? String(r.inspector_id) : null,
        checkedAt: Number.isFinite(epoch)
          ? toShanghaiRfc3339(new Date(epoch * 1000))
          : null,
        remark: r.remark ?? null,
        ...DEMO_SOURCE_META,
      };
      if (r.result === 'NG') {
        res.defects = defectsMap[String(r.id)] ?? [];
      }
      return res;
    });

    return buildPage(list, total, pagination.page, pagination.pageSize);
  }

  async listDefects(query: ListDefectsQueryDto): Promise<PageResult<DefectResponse>> {
    const pagination = normalizePagination(query);

    if (query.qcRecordId !== undefined && !isValidDecimalId(query.qcRecordId)) {
      throw invalidArgument({ field: 'qcRecordId', reason: 'qcRecordId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (query.workOrderId !== undefined && !isValidDecimalId(query.workOrderId)) {
      throw invalidArgument({ field: 'workOrderId', reason: 'workOrderId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (query.startDate !== undefined && !isValidDateOnly(query.startDate)) {
      throw invalidArgument({ field: 'startDate', reason: 'startDate 必须为真实存在的日期（YYYY-MM-DD）' });
    }
    if (query.endDate !== undefined && !isValidDateOnly(query.endDate)) {
      throw invalidArgument({ field: 'endDate', reason: 'endDate 必须为真实存在的日期（YYYY-MM-DD）' });
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

    if (query.qcRecordId !== undefined) {
      conditions.push('d.qc_record_id = ?');
      params.push(query.qcRecordId);
    }
    if (query.workOrderId !== undefined) {
      conditions.push('q.work_order_id = ?');
      params.push(query.workOrderId);
    }
    if (query.defectType !== undefined) {
      conditions.push('d.defect_type = ?');
      params.push(query.defectType);
    }
    if (query.startDate !== undefined) {
      conditions.push('d.created_at >= ?');
      params.push(`${query.startDate} 00:00:00`);
    }
    if (query.endDate !== undefined) {
      const nextDay = nextDayDateOnly(query.endDate);
      conditions.push('d.created_at < ?');
      params.push(`${nextDay} 00:00:00`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const joinSql = 'LEFT JOIN qc_record q ON d.qc_record_id = q.id';

    const countQuery = `SELECT COUNT(*) AS total FROM defect d ${joinSql} ${whereSql}`;
    const rowsQuery = `
      SELECT d.*, UNIX_TIMESTAMP(d.created_at) AS created_at_epoch
      FROM defect d
      ${joinSql}
      ${whereSql}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ? OFFSET ?
    `;

    const countRows = (await this.dataSource.query(countQuery, params)) as any[];
    const total = Number(countRows[0]?.total ?? 0);

    const rows = (await this.dataSource.query(rowsQuery, [
      ...params,
      pagination.take,
      pagination.skip,
    ])) as any[];

    const list: DefectResponse[] = rows.map((r) => {
      const epoch = Number(r.created_at_epoch);
      return {
        id: String(r.id),
        qcRecordId: String(r.qc_record_id),
        defectType: r.defect_type,
        qty: Number(r.qty),
        stepName: r.step_name ?? null,
        description: r.description ?? null,
        createdAt: Number.isFinite(epoch)
          ? toShanghaiRfc3339(new Date(epoch * 1000))
          : null,
        ...DEMO_SOURCE_META,
      };
    });

    return buildPage(list, total, pagination.page, pagination.pageSize);
  }
}
