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

import { CreateReportDto, MAX_INT } from './dto/create-report.dto.js';
import type { ListReportsQueryDto } from './dto/list-reports-query.dto.js';

export interface ReportItemResponse {
  id: string;
  taskId: string;
  userId: string;
  goodQty: number;
  badQty: number;
  reportedAt: string | null;
  dataSource: string;
  dataLabel: string;
}

export interface CreateReportResponse {
  report: ReportItemResponse;
  taskTotals: { goodQty: number; badQty: number };
  workOrderTotals: { doneQty: number };
  dataSource: string;
  dataLabel: string;
}

/**
 * B3 生产报工服务 —— 契约 §6.4。
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateReportDto,
    context: { userId: string; ip: string | null },
  ): Promise<CreateReportResponse> {
    if (!isValidDecimalId(dto.taskId)) {
      throw invalidArgument({ field: 'taskId', reason: 'taskId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (dto.goodQty + dto.badQty <= 0) {
      throw invalidArgument({ field: 'goodQty', reason: '报工良品和不良品数量之和必须大于 0' });
    }
    if (dto.goodQty > MAX_INT) {
      throw invalidArgument({ field: 'goodQty', reason: `goodQty 不得超过 ${MAX_INT}` });
    }
    if (dto.badQty > MAX_INT) {
      throw invalidArgument({ field: 'badQty', reason: `badQty 不得超过 ${MAX_INT}` });
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. 查询任务所属工单（轻量读取，确定上级工单 ID 以遵循全局固定加锁顺序：工单 -> 任务）
      const taskMeta = (await manager.query('SELECT work_order_id FROM work_task WHERE id = ?', [
        dto.taskId,
      ])) as any[];
      if (taskMeta.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工序任务不存在：${dto.taskId}`);
      }
      const workOrderId = taskMeta[0].work_order_id;

      // 2. 统一锁顺序：先锁定工单行（FOR UPDATE）
      const wos = (await manager.query(
        'SELECT id, status, done_qty FROM work_order WHERE id = ? FOR UPDATE',
        [workOrderId],
      )) as any[];
      if (wos.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '工单不存在');
      }
      const wo = wos[0];

      if (wo.status !== '在产') {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `工单当前状态为「${wo.status}」，仅在产工单允许报工`,
        );
      }

      // 3. 统一锁顺序：再锁定工序任务行（FOR UPDATE）
      const tasks = (await manager.query('SELECT * FROM work_task WHERE id = ? FOR UPDATE', [
        dto.taskId,
      ])) as any[];
      if (tasks.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工序任务不存在：${dto.taskId}`);
      }
      const task = tasks[0];

      if (task.status !== '在产') {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `任务当前状态为「${task.status}」，仅在产任务允许报工`,
        );
      }

      // Check cumulative overflow
      if (
        Number(task.good_qty) + dto.goodQty > MAX_INT ||
        Number(task.bad_qty) + dto.badQty > MAX_INT
      ) {
        throw new BusinessException(ErrorCode.INVALID_QUANTITY, '工序累计报工数量超出 INT 上限');
      }

      // 2. Insert report
      const insertResult = await manager.query(
        'INSERT INTO report (task_id, user_id, good_qty, bad_qty) VALUES (?, ?, ?, ?)',
        [dto.taskId, context.userId, dto.goodQty, dto.badQty],
      );
      const reportId = insertResult.insertId;

      // 3. Update task quantities
      await manager.query(
        'UPDATE work_task SET good_qty = good_qty + ?, bad_qty = bad_qty + ? WHERE id = ?',
        [dto.goodQty, dto.badQty, dto.taskId],
      );

      // 4. Update work order done_qty only if it is the max seq task
      const maxSeqTasks = (await manager.query(
        'SELECT id FROM work_task WHERE work_order_id = ? ORDER BY seq DESC LIMIT 1',
        [task.work_order_id],
      )) as any[];

      if (maxSeqTasks.length > 0 && String(maxSeqTasks[0].id) === String(dto.taskId)) {
        if (Number(wo.done_qty) + dto.goodQty > MAX_INT) {
          throw new BusinessException(
            ErrorCode.INVALID_QUANTITY,
            '工单累计完成数量超出 INT 上限',
          );
        }
        await manager.query('UPDATE work_order SET done_qty = done_qty + ? WHERE id = ?', [
          dto.goodQty,
          task.work_order_id,
        ]);
      }

      // 5. Audit
      await this.audit.write(manager, {
        userId: context.userId,
        action: '生产报工',
        target: `report:${reportId}`,
        detail: `工序 ${task.seq} 报工：良品 ${dto.goodQty}, 不良 ${dto.badQty}`,
        ip: context.ip,
      });

      // Fetch updated totals & created report using epoch timestamp
      const updatedTask = (await manager.query(
        'SELECT good_qty, bad_qty FROM work_task WHERE id = ?',
        [dto.taskId],
      )) as any[];
      const updatedWo = (await manager.query('SELECT done_qty FROM work_order WHERE id = ?', [
        task.work_order_id,
      ])) as any[];
      const createdReport = (await manager.query(
        'SELECT r.*, UNIX_TIMESTAMP(r.reported_at) AS reported_at_epoch FROM report r WHERE id = ?',
        [reportId],
      )) as any[];

      const epoch = Number(createdReport[0].reported_at_epoch);
      const reportedAt = Number.isFinite(epoch)
        ? toShanghaiRfc3339(new Date(epoch * 1000))
        : null;

      return {
        report: {
          id: String(reportId),
          taskId: String(dto.taskId),
          userId: String(context.userId),
          goodQty: dto.goodQty,
          badQty: dto.badQty,
          reportedAt,
          ...DEMO_SOURCE_META,
        },
        taskTotals: {
          goodQty: Number(updatedTask[0].good_qty),
          badQty: Number(updatedTask[0].bad_qty),
        },
        workOrderTotals: {
          doneQty: Number(updatedWo[0].done_qty),
        },
        ...DEMO_SOURCE_META,
      };
    });
  }

  async list(query: ListReportsQueryDto): Promise<PageResult<ReportItemResponse>> {
    const pagination = normalizePagination(query);

    if (query.taskId !== undefined && !isValidDecimalId(query.taskId)) {
      throw invalidArgument({ field: 'taskId', reason: 'taskId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (query.workOrderId !== undefined && !isValidDecimalId(query.workOrderId)) {
      throw invalidArgument({ field: 'workOrderId', reason: 'workOrderId 必须为正整数且不超过 BIGINT 上限' });
    }
    if (query.userId !== undefined && !isValidDecimalId(query.userId)) {
      throw invalidArgument({ field: 'userId', reason: 'userId 必须为正整数且不超过 BIGINT 上限' });
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

    if (query.taskId !== undefined) {
      conditions.push('r.task_id = ?');
      params.push(query.taskId);
    }
    if (query.userId !== undefined) {
      conditions.push('r.user_id = ?');
      params.push(query.userId);
    }
    if (query.workOrderId !== undefined) {
      conditions.push('t.work_order_id = ?');
      params.push(query.workOrderId);
    }
    if (query.startDate !== undefined) {
      conditions.push('r.reported_at >= ?');
      params.push(`${query.startDate} 00:00:00`);
    }
    if (query.endDate !== undefined) {
      const nextDay = nextDayDateOnly(query.endDate);
      conditions.push('r.reported_at < ?');
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
      'LEFT JOIN work_task t ON r.task_id = t.id LEFT JOIN work_order wo ON t.work_order_id = wo.id';

    const countQuery = `SELECT COUNT(*) AS total FROM report r ${joinSql} ${whereSql}`;
    const rowsQuery = `
      SELECT r.id, r.task_id, r.user_id, r.good_qty, r.bad_qty, UNIX_TIMESTAMP(r.reported_at) AS reported_at_epoch
      FROM report r
      ${joinSql}
      ${whereSql}
      ORDER BY r.reported_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `;

    // Count and rows share the exact same conditions and filter parameters
    const countRows = (await this.dataSource.query(countQuery, params)) as any[];
    const total = Number(countRows[0]?.total ?? 0);

    const rows = (await this.dataSource.query(rowsQuery, [
      ...params,
      pagination.take,
      pagination.skip,
    ])) as any[];

    const list: ReportItemResponse[] = rows.map((r) => {
      const epoch = Number(r.reported_at_epoch);
      return {
        id: String(r.id),
        taskId: String(r.task_id),
        userId: String(r.user_id),
        goodQty: Number(r.good_qty),
        badQty: Number(r.bad_qty),
        reportedAt: Number.isFinite(epoch)
          ? toShanghaiRfc3339(new Date(epoch * 1000))
          : null,
        ...DEMO_SOURCE_META,
      };
    });

    return buildPage(list, total, pagination.page, pagination.pageSize);
  }
}
