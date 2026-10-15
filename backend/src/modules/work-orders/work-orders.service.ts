import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { compareDateOnly, isValidDateOnly } from '../../common/utils/date-only.util.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { mysqlDatetimeToRfc3339 } from '../../common/utils/rfc3339.util.js';
import {
  assertField,
  escapeLikePattern,
  invalidArgument,
} from '../../common/utils/validation.util.js';
import { WorkOrder } from '../../entities/work-order.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { WORK_ORDER_STATUS } from '../orders/order-status.js';

import type { ListTasksQueryDto } from './dto/list-tasks-query.dto.js';
import type { ListWorkOrdersQueryDto } from './dto/list-work-orders-query.dto.js';
import type { TaskStateTransitionDto, WorkOrderStateTransitionDto } from './dto/state-transition.dto.js';
import type { UpdateTaskDto } from './dto/update-task.dto.js';
import type { UpdateWorkOrderDto } from './dto/update-work-order.dto.js';
import type {
  TaskResponse,
  TaskTransitionResponse,
  WorkOrderResponse,
  WorkOrderTransitionResponse,
} from './dto/work-order-response.js';
import { resolveTaskTransition, resolveWorkOrderTransition } from './work-order-state-machine.js';

interface WorkOrderRow {
  id: string | number | bigint;
  code: string;
  sale_order_id: string | number | bigint | null;
  product_code: string;
  qty: string | number;
  done_qty: string | number;
  status: string;
  plan_start: string | null;
  plan_end: string | null;
  created_by: string | number | bigint | null;
  created_at_epoch: string | number | null;
}

interface TaskRow {
  id: string | number | bigint;
  work_order_id: string | number | bigint;
  seq: string | number;
  step_name: string;
  workshop: string | null;
  prod_line: string | null;
  device_code: string | null;
  operator_id: string | number | bigint | null;
  plan_qty: string | number;
  good_qty: string | number;
  bad_qty: string | number;
  status: string;
  plan_start: string | null;
  plan_end: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * 日期/时间一律在 SQL 侧格式化：
 * - DATE 列 → `%Y-%m-%d`（与连接时区无关）；
 * - DATETIME 列 → `%Y-%m-%dT%H:%i:%s`（DATETIME 无时区，落库即业务时区墙钟）；
 * - TIMESTAMP 列 → `UNIX_TIMESTAMP()`（绝对时刻，再由服务端按 +08:00 格式化）。
 */
const WORK_ORDER_SELECT_COLUMNS = [
  'w.id AS id',
  'w.code AS code',
  'w.sale_order_id AS sale_order_id',
  'w.product_code AS product_code',
  'w.qty AS qty',
  'w.done_qty AS done_qty',
  'w.status AS status',
  "DATE_FORMAT(w.plan_start, '%Y-%m-%d') AS plan_start",
  "DATE_FORMAT(w.plan_end, '%Y-%m-%d') AS plan_end",
  'w.created_by AS created_by',
  'UNIX_TIMESTAMP(w.created_at) AS created_at_epoch',
].join(', ');

const TASK_SELECT_COLUMNS = [
  't.id AS id',
  't.work_order_id AS work_order_id',
  't.seq AS seq',
  't.step_name AS step_name',
  't.workshop AS workshop',
  't.prod_line AS prod_line',
  't.device_code AS device_code',
  't.operator_id AS operator_id',
  't.plan_qty AS plan_qty',
  't.good_qty AS good_qty',
  't.bad_qty AS bad_qty',
  't.status AS status',
  "DATE_FORMAT(t.plan_start, '%Y-%m-%dT%H:%i:%s') AS plan_start",
  "DATE_FORMAT(t.plan_end, '%Y-%m-%dT%H:%i:%s') AS plan_end",
  "DATE_FORMAT(t.started_at, '%Y-%m-%dT%H:%i:%s') AS started_at",
  "DATE_FORMAT(t.finished_at, '%Y-%m-%dT%H:%i:%s') AS finished_at",
].join(', ');

/**
 * B2 工单与工序任务服务 —— 契约 §6.3。
 *
 * 权限（契约 §5.2 第 6、7 行）：
 * - 读工单 / 工单 tasks / task 详情 → 三角色均可；
 * - 改工单计划、工单/任务状态流转、任务分配 → 仅 admin / manager（由控制器守卫强制）。
 *
 * ⚠️ Q2 未决项（不自行启用，逐条见交接文档）：
 * - 工单暂停 / 恢复 / 关闭流转 → `30006`；
 * - 工序顺序前置条件 → 不施加；
 * - 完工阈值 / 人工确认 / 自动触发点 → 不实现（不按数量自动完工）；
 * - 设备与操作员分配条件 → 只做契约明文的存在性校验，不施加未批准的条件。
 *
 * ⚠️ 工单 `doneQty` 口径已冻结为「只累计末道工序良品」，属 B3，本轮**不实现累计**，
 * 也不编造进度（读取时如实返回数据库原值）。
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 工单查询

  async list(query: ListWorkOrdersQueryDto): Promise<PageResult<WorkOrderResponse>> {
    const pagination = normalizePagination(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.saleOrderId !== undefined) {
      conditions.push('w.sale_order_id = ?');
      params.push(query.saleOrderId);
    }
    if (query.productCode !== undefined) {
      conditions.push('w.product_code = ?');
      params.push(query.productCode);
    }
    if (query.status !== undefined) {
      conditions.push('w.status = ?');
      params.push(query.status);
    }
    if (query.keyword !== undefined) {
      conditions.push("w.code LIKE ? ESCAPE '\\\\'");
      params.push(`%${escapeLikePattern(query.keyword)}%`);
    }

    let joinSql = '';
    if (query.prodLine !== undefined || query.workshop !== undefined) {
      joinSql = `
        LEFT JOIN (
          SELECT wt.work_order_id, wt.workshop, wt.prod_line
          FROM work_task wt
          WHERE wt.seq = (
            SELECT MAX(wt2.seq)
            FROM work_task wt2
            WHERE wt2.work_order_id = wt.work_order_id
          )
        ) last_task ON last_task.work_order_id = w.id
      `;

      if (query.prodLine !== undefined) {
        if (query.prodLine === '未分配') {
          conditions.push('(last_task.prod_line IS NULL OR last_task.prod_line = "" OR last_task.prod_line = "未分配")');
        } else {
          conditions.push('last_task.prod_line = ?');
          params.push(query.prodLine);
        }
      }

      if (query.workshop !== undefined) {
        if (query.workshop === '未分配') {
          conditions.push('(last_task.workshop IS NULL OR last_task.workshop = "" OR last_task.workshop = "未分配")');
        } else {
          conditions.push('last_task.workshop = ?');
          params.push(query.workshop);
        }
      }
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(DISTINCT w.id) AS total FROM work_order w ${joinSql} ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      `SELECT ${WORK_ORDER_SELECT_COLUMNS} FROM work_order w ${joinSql} ${whereSql} ORDER BY w.id ASC LIMIT ? OFFSET ?`,
      [...params, pagination.take, pagination.skip],
    )) as WorkOrderRow[];

    return buildPage(
      rows.map((row) => this.toWorkOrderResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  async findOne(rawId: string): Promise<WorkOrderResponse> {
    const id = this.assertId(rawId, 'id');
    const rows = (await this.dataSource.query(
      `SELECT ${WORK_ORDER_SELECT_COLUMNS} FROM work_order w WHERE w.id = ?`,
      [id],
    )) as WorkOrderRow[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工单不存在：${id}`);
    }
    return this.toWorkOrderResponse(rows[0]!);
  }

  // ---------------------------------------------------------------- 工单计划

  async updatePlan(
    rawId: string,
    dto: UpdateWorkOrderDto,
    context: { userId: string; ip: string | null },
  ): Promise<WorkOrderResponse> {
    const id = this.assertId(rawId, 'id');

    if (dto.planStart === undefined && dto.planEnd === undefined) {
      throw invalidArgument({
        field: 'body',
        reason: 'PATCH 至少需要提供 planStart / planEnd 中的一个字段',
      });
    }
    if (typeof dto.planStart === 'string') {
      assertField(isValidDateOnly(dto.planStart), 'planStart', 'planStart 必须为真实存在的日期（YYYY-MM-DD）');
    }
    if (typeof dto.planEnd === 'string') {
      assertField(isValidDateOnly(dto.planEnd), 'planEnd', 'planEnd 必须为真实存在的日期（YYYY-MM-DD）');
    }

    await this.dataSource.transaction(async (manager) => {
      const workOrder = await this.lockWorkOrder(manager, id);
      if (!workOrder) throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工单不存在：${id}`);

      // 契约 §6.3：仅「待启动」可编辑计划
      if (workOrder.status !== WORK_ORDER_STATUS.PENDING) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `工单当前状态为「${workOrder.status}」，仅「待启动」工单可修改计划。`,
        );
      }

      const nextStart = dto.planStart === undefined ? workOrder.planStart : dto.planStart;
      const nextEnd = dto.planEnd === undefined ? workOrder.planEnd : dto.planEnd;

      if (nextStart !== null && nextEnd !== null && compareDateOnly(nextStart, nextEnd) > 0) {
        throw invalidArgument({ field: 'planStart', reason: '计划开始日期不得晚于计划结束日期' });
      }

      await manager.update(WorkOrder, { id }, { planStart: nextStart, planEnd: nextEnd });

      await this.audit.write(manager, {
        userId: context.userId,
        action: '修改工单计划',
        target: `work_order:${id}`,
        detail: `工单 ${workOrder.code} 计划调整为 ${nextStart ?? 'null'} ~ ${nextEnd ?? 'null'}`,
        ip: context.ip,
      });
    });

    return this.findOne(id);
  }

  // ---------------------------------------------------------------- 任务查询

  async listTasks(rawId: string, query: ListTasksQueryDto): Promise<PageResult<TaskResponse>> {
    const workOrderId = this.assertId(rawId, 'id');
    await this.assertWorkOrderExists(workOrderId);
    const pagination = normalizePagination(query);

    const conditions = ['t.work_order_id = ?'];
    const params: unknown[] = [workOrderId];
    if (query.status !== undefined) {
      conditions.push('t.status = ?');
      params.push(query.status);
    }
    const whereSql = `WHERE ${conditions.join(' AND ')}`;

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM work_task t ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      `SELECT ${TASK_SELECT_COLUMNS} FROM work_task t ${whereSql} ORDER BY t.id ASC LIMIT ? OFFSET ?`,
      [...params, pagination.take, pagination.skip],
    )) as TaskRow[];

    return buildPage(
      rows.map((row) => this.toTaskResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  async findTask(rawId: string): Promise<TaskResponse> {
    const id = this.assertId(rawId, 'id');
    const rows = (await this.dataSource.query(
      `SELECT ${TASK_SELECT_COLUMNS} FROM work_task t WHERE t.id = ?`,
      [id],
    )) as TaskRow[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工序任务不存在：${id}`);
    }
    return this.toTaskResponse(rows[0]!);
  }

  // ---------------------------------------------------------------- 任务修改（Q2 未决：不启用写入）

  async updateTask(
    rawId: string,
    dto: UpdateTaskDto,
    context: { userId: string; ip: string | null },
  ): Promise<TaskResponse> {
    const id = this.assertId(rawId, 'id');
    
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT * FROM work_task WHERE id = ? FOR UPDATE', [id]) as any[];
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工序任务不存在：${id}`);
      }
      const task = rows[0];

      // 目标状态（修改后完整分配结果）
      const nextStart = dto.planStart === undefined ? task.plan_start : dto.planStart;
      const nextEnd = dto.planEnd === undefined ? task.plan_end : dto.planEnd;
      const targetOperatorId = dto.operatorId === undefined ? task.operator_id : dto.operatorId;
      const targetProdLine = dto.prodLine === undefined ? task.prod_line : dto.prodLine;
      const targetDeviceCode = dto.deviceCode === undefined ? task.device_code : dto.deviceCode;

      // 1. 时间起止顺序校验
      if (nextStart && nextEnd && new Date(nextStart) > new Date(nextEnd)) {
        throw invalidArgument({ field: 'planStart', reason: '计划开始时间不得晚于计划结束时间' });
      }

      // 2. 操作员可用性校验
      if (targetOperatorId !== undefined && targetOperatorId !== null) {
        const userRows = (await manager.query('SELECT enabled FROM sys_user WHERE id = ?', [
          targetOperatorId,
        ])) as any[];
        if (userRows.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '操作员不存在');
        }
        if (!userRows[0].enabled) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '操作员未启用');
        }
      }

      // 3. 产线车间范围校验（产线只允许在任务所属车间内变更）
      if (
        task.workshop !== null &&
        task.workshop !== undefined &&
        targetProdLine !== null &&
        targetProdLine !== undefined
      ) {
        const lineRows = (await manager.query(
          'SELECT 1 FROM device WHERE workshop = ? AND prod_line = ? UNION SELECT 1 FROM process_route WHERE workshop = ? AND prod_line = ?',
          [task.workshop, targetProdLine, task.workshop, targetProdLine],
        )) as any[];
        if (lineRows.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '产线不属于任务所在车间');
        }
      }

      // 4. 设备完整校验（针对修改后的目标设备，协同校验状态、产线一致性与车间一致性）
      if (targetDeviceCode !== undefined && targetDeviceCode !== null) {
        const devRows = (await manager.query(
          'SELECT status, prod_line, workshop FROM device WHERE code = ?',
          [targetDeviceCode],
        )) as any[];
        if (devRows.length === 0) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '设备不存在');
        }
        if (devRows[0].status !== '运行中') {
          throw new BusinessException(ErrorCode.INVALID_STATE_TRANSITION, '设备当前状态不是运行中');
        }
        if (
          devRows[0].prod_line !== null &&
          targetProdLine !== null &&
          targetProdLine !== undefined &&
          devRows[0].prod_line !== targetProdLine
        ) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '设备所属产线与任务产线不一致');
        }
        if (
          task.workshop !== null &&
          task.workshop !== undefined &&
          devRows[0].workshop !== null &&
          devRows[0].workshop !== undefined &&
          devRows[0].workshop !== task.workshop
        ) {
          throw new BusinessException(ErrorCode.INVALID_REFERENCE, '设备所属车间与任务车间不一致');
        }
      }

      const updates: any = {};
      if (dto.deviceCode !== undefined) updates.device_code = dto.deviceCode;
      if (dto.operatorId !== undefined) updates.operator_id = dto.operatorId;
      if (dto.prodLine !== undefined) updates.prod_line = dto.prodLine;
      if (dto.planStart !== undefined) updates.plan_start = dto.planStart;
      if (dto.planEnd !== undefined) updates.plan_end = dto.planEnd;

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        await manager.query(`UPDATE work_task SET ${setClauses} WHERE id = ?`, [...values, id]);
        
        await this.audit.write(manager, {
          userId: context.userId,
          action: '分配工序任务',
          target: `work_task:${id}`,
          detail: `更新任务分配/计划`,
          ip: context.ip,
        });
      }
    });

    return this.findTask(id);
  }

  // ---------------------------------------------------------------- 状态流转

  async transitionWorkOrder(
    rawId: string,
    dto: WorkOrderStateTransitionDto,
    context: { userId: string; ip: string | null },
  ): Promise<WorkOrderTransitionResponse> {
    const id = this.assertId(rawId, 'id');

    return this.dataSource.transaction(async (manager) => {
      const workOrder = await this.lockWorkOrder(manager, id);
      if (!workOrder) throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工单不存在：${id}`);

      if (workOrder.status !== dto.expectedStatus) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `工单当前状态为「${workOrder.status}」，与 expectedStatus「${dto.expectedStatus}」不一致。`,
        );
      }

      const decision = resolveWorkOrderTransition(workOrder.status, dto.targetStatus);
      if (decision.kind === 'blocked-q2') {
        throw new BusinessException(ErrorCode.CAPABILITY_UNAVAILABLE, decision.message);
      }
      if (decision.kind === 'invalid') {
        throw new BusinessException(ErrorCode.INVALID_STATE_TRANSITION, decision.message);
      }

      await manager.update(WorkOrder, { id }, { status: dto.targetStatus });

      await this.audit.write(manager, {
        userId: context.userId,
        action: '工单状态流转',
        target: `work_order:${id}`,
        detail: `工单 ${workOrder.code}：${workOrder.status} → ${dto.targetStatus}`,
        ip: context.ip,
      });

      return { id, status: dto.targetStatus, ...DEMO_SOURCE_META };
    });
  }

  async transitionTask(
    rawId: string,
    dto: TaskStateTransitionDto,
    context: { userId: string; ip: string | null },
  ): Promise<TaskTransitionResponse> {
    const id = this.assertId(rawId, 'id');
    
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT * FROM work_task WHERE id = ? FOR UPDATE', [id]) as any[];
      if (rows.length === 0) throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工序任务不存在：${id}`);
      const task = rows[0];

      if (task.status !== dto.expectedStatus) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `任务当前状态为「${task.status}」，与 expectedStatus「${dto.expectedStatus}」不一致。`,
        );
      }

      const decision = resolveTaskTransition(task.status, dto.targetStatus);
      if (decision.kind === 'invalid') {
        throw new BusinessException(ErrorCode.INVALID_STATE_TRANSITION, decision.message);
      }

      if (dto.targetStatus === '在产') {
        const prevTasks = await manager.query(
          'SELECT status FROM work_task WHERE work_order_id = ? AND seq < ?',
          [task.work_order_id, task.seq]
        ) as any[];
        if (prevTasks.some(t => t.status !== '完工')) {
          throw new BusinessException(ErrorCode.INVALID_STATE_TRANSITION, '前序任务未全部完工');
        }
      }

      let startedAt = task.started_at;
      let finishedAt = task.finished_at;
      if (dto.targetStatus === '在产' && !startedAt) {
        await manager.query('UPDATE work_task SET status = ?, started_at = NOW() WHERE id = ?', [dto.targetStatus, id]);
      } else if (dto.targetStatus === '完工' && !finishedAt) {
        await manager.query('UPDATE work_task SET status = ?, finished_at = NOW() WHERE id = ?', [dto.targetStatus, id]);
      } else {
        await manager.query('UPDATE work_task SET status = ? WHERE id = ?', [dto.targetStatus, id]);
      }

      await this.audit.write(manager, {
        userId: context.userId,
        action: '任务状态流转',
        target: `work_task:${id}`,
        detail: `任务 ${task.seq}：${task.status} → ${dto.targetStatus}`,
        ip: context.ip,
      });

      const updated = await manager.query(`SELECT ${TASK_SELECT_COLUMNS} FROM work_task t WHERE t.id = ?`, [id]) as any[];
      return this.toTaskResponse(updated[0]);
    });
  }

  // ---------------------------------------------------------------- 内部实现

  private assertId(rawId: string, field: string): string {
    if (!isValidDecimalId(rawId)) {
      throw invalidArgument({ field, reason: `${field} 必须为正整数（十进制字符串）` });
    }
    return rawId;
  }

  private async assertWorkOrderExists(id: string): Promise<void> {
    const rows = (await this.dataSource.query('SELECT id FROM work_order WHERE id = ?', [id])) as unknown[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工单不存在：${id}`);
    }
  }

  private async assertTaskExists(id: string): Promise<void> {
    const rows = (await this.dataSource.query('SELECT id FROM work_task WHERE id = ?', [id])) as unknown[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `工序任务不存在：${id}`);
    }
  }

  private lockWorkOrder(manager: EntityManager, id: string): Promise<WorkOrder | null> {
    return manager
      .createQueryBuilder(WorkOrder, 'w')
      .setLock('pessimistic_write')
      .where('w.id = :id', { id })
      .getOne();
  }

  private toWorkOrderResponse(row: WorkOrderRow): WorkOrderResponse {
    return {
      id: String(row.id),
      code: row.code,
      saleOrderId: row.sale_order_id === null ? null : String(row.sale_order_id),
      productCode: row.product_code,
      qty: Number(row.qty),
      doneQty: Number(row.done_qty),
      status: row.status,
      planStart: row.plan_start,
      planEnd: row.plan_end,
      createdBy: row.created_by === null ? null : String(row.created_by),
      createdAt:
        row.created_at_epoch === null
          ? null
          : toShanghaiRfc3339(new Date(Number(row.created_at_epoch) * 1000)),
      ...DEMO_SOURCE_META,
    };
  }

  private toTaskResponse(row: TaskRow): TaskResponse {
    return {
      id: String(row.id),
      workOrderId: String(row.work_order_id),
      seq: Number(row.seq),
      stepName: row.step_name,
      workshop: row.workshop,
      prodLine: row.prod_line,
      deviceCode: row.device_code,
      operatorId: row.operator_id === null ? null : String(row.operator_id),
      planQty: Number(row.plan_qty),
      goodQty: Number(row.good_qty),
      badQty: Number(row.bad_qty),
      status: row.status,
      planStart: mysqlDatetimeToRfc3339(row.plan_start),
      planEnd: mysqlDatetimeToRfc3339(row.plan_end),
      startedAt: mysqlDatetimeToRfc3339(row.started_at),
      finishedAt: mysqlDatetimeToRfc3339(row.finished_at),
      ...DEMO_SOURCE_META,
    };
  }
}

