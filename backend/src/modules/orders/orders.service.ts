import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { toShanghaiDate, toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { redactForLog } from '../../common/utils/redact.util.js';
import { compareDateOnly, isValidDateOnly } from '../../common/utils/date-only.util.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { lockProductRow } from '../../common/utils/product-lock.util.js';
import {
  assertField,
  escapeLikePattern,
  invalidArgument,
  invalidReference,
  isDuplicateKeyError,
  isRetryableTransactionError,
} from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ProcessRoute } from '../../entities/process-route.entity.js';
import { Product } from '../../entities/product.entity.js';
import { SaleOrder } from '../../entities/sale-order.entity.js';
import { WorkOrder } from '../../entities/work-order.entity.js';
import { WorkTask } from '../../entities/work-task.entity.js';

import type { ConfirmOrderDto } from './dto/confirm-order.dto.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import type { UpdateOrderDto } from './dto/update-order.dto.js';
import type {
  ConfirmationWorkOrderSummary,
  OrderConfirmationResponse,
  OrderResponse,
} from './dto/order-response.js';
import { buildDerivedOrderStatusSql, ORDER_STATUS, WORK_ORDER_STATUS } from './order-status.js';
import {
  formatWorkOrderCode,
  WORK_ORDER_CODE_MAX_ATTEMPTS,
  WORK_ORDER_MAX_SEQ,
  workOrderCodePrefix,
  workOrderCodeRegexSource,
} from './work-order-code.js';
import { normalizePagination, type NormalizedPagination } from '../../common/dto/pagination.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';

/** 允许执行 SQL 的对象（DataSource 与事务内 EntityManager 通用） */
interface SqlRunner {
  query(query: string, parameters?: unknown[]): Promise<unknown>;
}

/**
 * 事务级并发重试参数（任务书 §二.8「事务重试边界」）。
 *
 * 背景：多个订单并发确认时，各事务会先尝试同一个当日序号（如 `-001`），
 * 撞唯一键后各自改试 `-002` —— 多个事务同时持有同一索引记录的 S 锁再申请插入意向锁，
 * 会触发 InnoDB **死锁（1213）**，此时 InnoDB 会**回滚整个事务**。
 * 语句级重试无法恢复，必须重跑整个事务。
 *
 * 边界：最多 5 次，退避 20ms × 次数（避免同步重试再次相撞）；
 * 超限返回 30002（可重试的并发冲突，而非内部错误）。
 */
export const TX_MAX_ATTEMPTS = 5;
export const TX_RETRY_BASE_DELAY_MS = 20;

/**
 * 编号分配的命名锁（MySQL `GET_LOCK`）等待上限（秒）。
 *
 * 命名锁不是表、不是列、也不是事务锁，**不改变任何表结构**：
 * 它把「读当日最大序号 + 插入工单」这段临界区串行化，
 * 从源头消除「多个事务同插同一编号 → S 锁互等 → InnoDB 死锁」。
 * 临界区只有一条 INSERT，持锁时间极短。
 */
export const WORK_ORDER_CODE_LOCK_TIMEOUT_SECONDS = 5;

/** 订单列表/详情的原始行 */
interface OrderRow {
  id: string | number | bigint;
  code: string;
  product_code: string;
  qty: string | number;
  due_date: string;
  status: string;
  created_by: string | number | bigint | null;
  created_at_epoch: string | number | null;
  derived_status: string;
}

interface OrderFilter {
  id?: string;
  status?: string;
  productCode?: string;
  keyword?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}

/** 列表查询所需的 SELECT 列（日期一律在 SQL 侧格式化，避免驱动时区差异） */
const ORDER_SELECT_COLUMNS = [
  'o.id AS id',
  'o.code AS code',
  'o.product_code AS product_code',
  'o.qty AS qty',
  "DATE_FORMAT(o.due_date, '%Y-%m-%d') AS due_date",
  'o.status AS status',
  'o.created_by AS created_by',
  // TIMESTAMP → 秒级 epoch（与时区无关），再由服务端按 Asia/Shanghai 格式化
  'UNIX_TIMESTAMP(o.created_at) AS created_at_epoch',
].join(', ');

/**
 * 订单服务 —— 契约 §6.2（B1）。
 *
 * 核心不变量：
 * 1. **一单一工单**：确认时锁定订单行并检查既有工单；已有多张则返回 `30002`，不删数据；
 * 2. **事务原子性**：确认 = 锁定 → 校验 → 复制工序 → 生成工单 → 更新订单 → 写审计，
 *    任一步失败整体回滚（不留残缺工单/任务/审计）；
 * 3. **编号并发安全**：`WO-YYYYMMDD-NNN` 依赖 `work_order.code` 唯一约束 + 冲突重试，
 *    **不使用无并发保护的 MAX+1**；
 * 4. **状态口径统一**：列表筛选、总数、分页与详情共用同一段派生状态 SQL。
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 查询

  async list(query: ListOrdersQueryDto): Promise<PageResult<OrderResponse>> {
    const pagination: NormalizedPagination = normalizePagination(query);
    const today = this.businessDate();
    const filter: OrderFilter = {
      status: query.status,
      productCode: query.productCode,
      keyword: query.keyword,
      dueDateFrom: query.dueDateFrom,
      dueDateTo: query.dueDateTo,
    };
    this.assertDateRange(filter.dueDateFrom, filter.dueDateTo);

    const { innerSql, params } = this.buildOrderQuery(today, filter);
    const outerWhere = filter.status ? 'WHERE t.derived_status = ?' : '';
    const outerParams = filter.status ? [...params, filter.status] : [...params];

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${innerSql}) t ${outerWhere}`,
      outerParams,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      `SELECT * FROM (${innerSql}) t ${outerWhere} ORDER BY t.id ASC LIMIT ? OFFSET ?`,
      [...outerParams, pagination.take, pagination.skip],
    )) as OrderRow[];

    const total = Number(countRows[0]?.total ?? 0);
    return buildPage(
      rows.map((row) => this.toOrderResponse(row)),
      total,
      pagination.page,
      pagination.pageSize,
    );
  }

  async findOne(rawId: string): Promise<OrderResponse> {
    const id = this.assertOrderId(rawId);
    const rows = (await this.readOrderRows(this.dataSource, { id }, this.businessDate())) as OrderRow[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `订单不存在：${id}`);
    }
    return this.toOrderResponse(rows[0]!);
  }

  // ---------------------------------------------------------------- 创建

  async create(
    dto: CreateOrderDto,
    context: { userId: string; ip: string | null },
  ): Promise<OrderResponse> {
    assertField(isValidDateOnly(dto.dueDate), 'dueDate', 'dueDate 必须为真实存在的日期（YYYY-MM-DD）');

    const orderId = await this.withTransactionRetry('创建订单', async (manager) => {
      await this.assertProductExists(manager, dto.productCode);

      // 预检查用于给出友好错误，但**不能**作为唯一保证：
      // 两个并发请求可能同时查不到该编号，随后由 `sale_order.code` 唯一约束兜底。
      const duplicated = await manager.findOne(SaleOrder, { where: { code: dto.code } });
      if (duplicated) throw this.orderCodeConflict();

      let inserted;
      try {
        inserted = await manager.insert(SaleOrder, {
          code: dto.code,
          productCode: dto.productCode,
          qty: dto.qty,
          dueDate: dto.dueDate,
          status: ORDER_STATUS.PENDING,
          createdBy: context.userId,
        });
      } catch (error) {
        // 并发下唯一键冲突：转换为 30002，**不得**把 ER_DUP_ENTRY 透传成 500
        // （审查 P2：「并发创建相同订单号可能返回 500，而非 409/30002」）
        if (isDuplicateKeyError(error)) throw this.orderCodeConflict();
        throw error;
      }

      const created = await manager.findOne(SaleOrder, { where: { code: dto.code } });
      const id = String(created?.id ?? inserted.identifiers[0]?.id ?? '');

      await this.audit.write(manager, {
        userId: context.userId,
        action: '创建订单',
        target: `sale_order:${id}`,
        detail: `创建订单 ${dto.code}（产品 ${dto.productCode}，数量 ${dto.qty}，交期 ${dto.dueDate}）`,
        ip: context.ip,
      });

      return id;
    });

    return this.findOne(orderId);
  }

  // ---------------------------------------------------------------- 修改

  async update(
    rawId: string,
    dto: UpdateOrderDto,
    context: { userId: string; ip: string | null },
  ): Promise<OrderResponse> {
    const id = this.assertOrderId(rawId);

    if (dto.productCode === undefined && dto.qty === undefined && dto.dueDate === undefined) {
      throw invalidArgument({
        field: 'body',
        reason: 'PATCH 至少需要提供 productCode / qty / dueDate 中的一个字段',
      });
    }
    if (dto.dueDate !== undefined) {
      assertField(isValidDateOnly(dto.dueDate), 'dueDate', 'dueDate 必须为真实存在的日期（YYYY-MM-DD）');
    }

    await this.withTransactionRetry('修改订单', async (manager) => {
      const order = await this.lockOrder(manager, id);
      if (!order) throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `订单不存在：${id}`);

      // 编辑限制：只允许生命周期原值为「待确认」的订单（契约 §6.2）
      // 说明：已延期/生产中/已完成是查询期派生状态，不改变可编辑性判定。
      if (order.status !== ORDER_STATUS.PENDING) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `订单当前状态为「${order.status}」，仅「待确认」订单可编辑。`,
        );
      }

      const patch: Partial<SaleOrder> = {};
      if (dto.productCode !== undefined) {
        await this.assertProductExists(manager, dto.productCode);
        patch.productCode = dto.productCode;
      }
      if (dto.qty !== undefined) patch.qty = dto.qty;
      if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;

      await manager.update(SaleOrder, { id }, patch);

      await this.audit.write(manager, {
        userId: context.userId,
        action: '修改订单',
        target: `sale_order:${id}`,
        detail: `修改订单 ${order.code}：${Object.entries(patch)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join('，')}`,
        ip: context.ip,
      });
    });

    return this.findOne(id);
  }

  // ---------------------------------------------------------------- 确认（本轮核心闭环）

  async confirm(
    rawId: string,
    dto: ConfirmOrderDto,
    context: { userId: string; ip: string | null },
  ): Promise<OrderConfirmationResponse> {
    const id = this.assertOrderId(rawId);
    const today = this.businessDate();

    return this.withTransactionRetry('确认订单', async (manager) => {
      // 1) 锁定订单行 —— 并发确认同一订单在此串行化
      const order = await this.lockOrder(manager, id);
      if (!order) throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `订单不存在：${id}`);

      // 1.5) 产品行锁 —— 与 BOM 写事务共用同一互斥协议（S10 复审 P2 修复 · 第二轮）。
      //      锁 `sale_order` 行只串行化「同一订单的并发确认」；BOM 事务锁的是 `bom` 行，
      //      两者无共同资源。此处锁定**持久化产品行**，其行锁在**事务提交时**才释放，
      //      因此 BOM 写事务会阻塞到本事务提交完成，随后读到已提交的订单/工单 → 引用保护成立。
      //      （第一版用会话级 GET_LOCK，在事务回调 finally 提前释放、未覆盖提交点，已废弃。）
      //      ⚠️ 本调用必须是**读取既有工单与任何写入之前**、且在事务内尽早执行。
      await lockProductRow(manager, order.productCode);

      // 2) 检查既有工单（sale_order_id 无唯一约束，必须显式检查）
      const existing = await manager.find(WorkOrder, {
        where: { saleOrderId: id },
        order: { id: 'ASC' },
      });

      if (existing.length > 1) {
        // 契约 §6.2：发现多张工单返回 30002 并报告数据冲突，不自动删单、不任选一张
        throw new BusinessException(
          ErrorCode.RESOURCE_CONFLICT,
          `订单 ${order.code} 已关联 ${existing.length} 张工单，属数据冲突，需人工核查（本接口不修改数据）。`,
          { orderId: id, workOrderCount: existing.length },
        );
      }

      if (existing.length === 1) {
        // 3) 重复确认 = 恢复读取：返回现有唯一工单与当前订单状态（不受 expectedStatus 限制）
        const workOrder = existing[0]!;
        return this.buildConfirmationResponse(manager, order, workOrder, today);
      }

      // 4) expectedStatus 控制字段校验（契约 §2.4）
      if (order.status !== dto.expectedStatus) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `订单当前状态为「${order.status}」，与 expectedStatus「${dto.expectedStatus}」不一致。`,
        );
      }

      // 5) 复制真实工艺明细为任务；无明细则整个事务失败（契约 §2.4）
      const routes = await manager.find(ProcessRoute, {
        where: { productCode: order.productCode },
        order: { seq: 'ASC' },
      });
      if (routes.length === 0) {
        throw new BusinessException(
          ErrorCode.MISSING_PREREQUISITE,
          `产品 ${order.productCode} 没有可拆解的工序明细（process_route），无法生成工单与任务。`,
          { productCode: order.productCode },
        );
      }
      this.assertRouteSeqUnique(routes);

      // 6) 生成唯一工单（编号并发安全）
      const workOrder = await this.insertWorkOrderWithCode(manager, {
        saleOrderId: id,
        productCode: order.productCode,
        qty: order.qty,
        createdBy: context.userId,
        today,
      });

      // 7) 复制工艺路线为工序任务
      await this.insertTasks(
        manager,
        routes.map((route) => ({
          workOrderId: workOrder.id,
          seq: route.seq,
          stepName: route.stepName,
          workshop: route.workshop,
          prodLine: route.prodLine,
          deviceCode: null,
          operatorId: null,
          planQty: order.qty,
          goodQty: 0,
          badQty: 0,
          status: WORK_ORDER_STATUS.PENDING,
          planStart: null,
          planEnd: null,
          startedAt: null,
          finishedAt: null,
        })),
      );

      // 8) 更新订单状态为「已确认」
      await manager.update(SaleOrder, { id }, { status: ORDER_STATUS.CONFIRMED });

      // 9) 审计（与业务同事务；失败则整体回滚）
      await this.writeConfirmationAudit(manager, {
        userId: context.userId,
        ip: context.ip,
        orderCode: order.code,
        orderId: id,
        workOrderCode: workOrder.code,
        taskCount: routes.length,
      });

      const confirmed: SaleOrder = { ...order, status: ORDER_STATUS.CONFIRMED };
      return this.buildConfirmationResponse(
        manager,
        confirmed,
        { id: workOrder.id, code: workOrder.code } as WorkOrder,
        today,
      );
    });
  }

  // ---------------------------------------------------------------- 事务内步骤（可被测试替身单独替换）

  /** 写入工序任务（独立方法，便于隔离测试注入写入失败以验证回滚） */
  protected async insertTasks(
    manager: EntityManager,
    rows: ReadonlyArray<Partial<WorkTask>>,
  ): Promise<void> {
    await manager.insert(WorkTask, rows as WorkTask[]);
  }

  /** 写审计（独立方法，便于隔离测试注入审计失败以验证回滚） */
  protected async writeConfirmationAudit(
    manager: EntityManager,
    input: {
      userId: string;
      ip: string | null;
      orderCode: string;
      orderId: string;
      workOrderCode: string;
      taskCount: number;
    },
  ): Promise<void> {
    await this.audit.write(manager, {
      userId: input.userId,
      action: '确认订单',
      target: `sale_order:${input.orderId}`,
      detail: `确认订单 ${input.orderCode}，生成工单 ${input.workOrderCode}（${input.taskCount} 道工序）`,
      ip: input.ip,
    });
  }

  // ---------------------------------------------------------------- 内部实现

  private businessDate(): string {
    return toShanghaiDate(new Date());
  }

  /** 订单编号冲突（预检查命中或并发下唯一键冲突）→ 统一 30002 */
  private orderCodeConflict(): BusinessException {
    return new BusinessException(ErrorCode.RESOURCE_CONFLICT, '订单编号已存在', {
      errors: [{ field: 'code', reason: '订单编号已存在' }],
    });
  }

  /**
   * 事务级并发重试（任务书 §二.8「事务重试边界」）。
   *
   * 为什么需要：多个订单并发确认时，各事务会先尝试同一个当日序号（如 `-001`），
   * 撞唯一键后各自改试 `-002`；多个事务同时持有同一索引记录的 S 锁再申请插入意向锁，
   * 会触发 InnoDB **死锁（1213）**，此时 InnoDB **回滚整个事务**——
   * 语句级重试无法恢复，只能重跑整个事务。
   *
   * 只对 `ER_LOCK_DEADLOCK(1213)` / `ER_LOCK_WAIT_TIMEOUT(1205)` 重试；
   * 业务异常（30003 / 30005 / 30002 等）不命中此处，照常抛出。
   *
   * 幂等性前提：被包裹的三段写事务都是「先读后写」的幂等形态
   * （创建按唯一 code 去重、修改按 id 定位、确认先检查既有工单），
   * 因此整事务重跑不会产生重复数据。
   */
  private async withTransactionRetry<T>(
    label: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < TX_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction(work);
      } catch (error) {
        if (!isRetryableTransactionError(error)) throw error;
        // 内部细节只进服务端日志，不回传客户端（避免泄露 SQL）；
        // 日志侧同样脱敏 —— 驱动报错可能带连接串或口令（审查 P1）
        this.logger.warn(
          redactForLog(
            `[${label}] 第 ${attempt + 1} 次事务因并发冲突被回滚，准备重试：${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        // 退避，避免重试时再次与同一批事务相撞
        await delay(TX_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
    throw new BusinessException(
      ErrorCode.RESOURCE_CONFLICT,
      `${label}并发冲突重试 ${TX_MAX_ATTEMPTS} 次仍未成功，请稍后重试。`,
    );
  }

  private assertOrderId(rawId: string): string {
    if (!isValidDecimalId(rawId)) {
      throw invalidArgument({ field: 'id', reason: 'id 必须为正整数（十进制字符串）' });
    }
    return rawId;
  }

  private assertDateRange(from?: string, to?: string): void {
    if (from !== undefined) {
      assertField(isValidDateOnly(from), 'dueDateFrom', 'dueDateFrom 必须为真实存在的日期（YYYY-MM-DD）');
    }
    if (to !== undefined) {
      assertField(isValidDateOnly(to), 'dueDateTo', 'dueDateTo 必须为真实存在的日期（YYYY-MM-DD）');
    }
    if (from !== undefined && to !== undefined && compareDateOnly(from, to) > 0) {
      throw invalidArgument({ field: 'dueDateFrom', reason: 'dueDateFrom 不得晚于 dueDateTo' });
    }
  }

  /** 组装订单派生查询（内层子查询含派生状态，外层做状态过滤/分页，保证口径一致） */
  private buildOrderQuery(
    today: string,
    filter: OrderFilter,
  ): { innerSql: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.id !== undefined) {
      conditions.push('o.id = ?');
      params.push(filter.id);
    }
    if (filter.productCode !== undefined) {
      conditions.push('o.product_code = ?');
      params.push(filter.productCode);
    }
    if (filter.keyword !== undefined) {
      conditions.push("o.code LIKE ? ESCAPE '\\\\'");
      params.push(`%${escapeLikePattern(filter.keyword)}%`);
    }
    if (filter.dueDateFrom !== undefined) {
      conditions.push('o.due_date >= ?');
      params.push(filter.dueDateFrom);
    }
    if (filter.dueDateTo !== undefined) {
      conditions.push('o.due_date <= ?');
      params.push(filter.dueDateTo);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const innerSql = [
      `SELECT ${ORDER_SELECT_COLUMNS},`,
      `(${buildDerivedOrderStatusSql(today)}) AS derived_status`,
      'FROM sale_order o',
      whereSql,
    ].join('\n');

    return { innerSql, params };
  }

  private async readOrderRows(
    runner: SqlRunner,
    filter: OrderFilter,
    today: string,
  ): Promise<unknown[]> {
    const { innerSql, params } = this.buildOrderQuery(today, filter);
    const rows = await runner.query(`SELECT * FROM (${innerSql}) t ORDER BY t.id ASC`, params);
    return rows as unknown[];
  }

  private toOrderResponse(row: OrderRow): OrderResponse {
    return {
      id: String(row.id),
      code: row.code,
      productCode: row.product_code,
      qty: Number(row.qty),
      dueDate: row.due_date,
      status: row.derived_status,
      createdBy: row.created_by === null ? null : String(row.created_by),
      createdAt:
        row.created_at_epoch === null
          ? null
          : toShanghaiRfc3339(new Date(Number(row.created_at_epoch) * 1000)),
      ...DEMO_SOURCE_META,
    };
  }

  private async assertProductExists(manager: EntityManager, productCode: string): Promise<void> {
    const product = await manager.findOne(Product, { where: { code: productCode } });
    if (!product) {
      throw invalidReference('productCode', `产品编号不存在：${productCode}`);
    }
  }

  /** 锁定订单行（`SELECT … FOR UPDATE`） */
  private async lockOrder(manager: EntityManager, id: string): Promise<SaleOrder | null> {
    return manager
      .createQueryBuilder(SaleOrder, 'o')
      .setLock('pessimistic_write')
      .where('o.id = :id', { id })
      .getOne();
  }

  private assertRouteSeqUnique(routes: ReadonlyArray<ProcessRoute>): void {
    const seqs = new Set<number>();
    for (const route of routes) {
      if (seqs.has(route.seq)) {
        throw new BusinessException(
          ErrorCode.RESOURCE_CONFLICT,
          `工艺路线存在重复的工序序号 seq=${route.seq}，无法生成唯一工序任务。`,
        );
      }
      seqs.add(route.seq);
    }
  }

  /**
   * 生成唯一工单编号并落库。
   *
   * 并发策略（任务书 §二.8 要求说明「锁、唯一冲突处理和事务重试边界」）：
   * - **锁（两层）**：
   *   1. `sale_order` 行 `FOR UPDATE` —— 同一订单的并发确认在此串行；
   *   2. MySQL **命名锁** `mes:work_order_code:<日期>` —— 把跨订单的
   *      「读当日最大序号 + 插入工单」临界区串行化，从源头消除同插同一编号的争用；
   * - **唯一冲突处理**：命名锁失效（如进程被强杀后锁残留）时仍由 `work_order.code`
   *   唯一约束兜底——插入撞唯一键（ER_DUP_ENTRY）时序号 +1 重试；
   * - **事务重试边界**（两层）：
   *   1. **语句级**：只重试「插入工单」这一条语句（MySQL 唯一键冲突只回滚该语句、
   *      不回滚整个事务），最多 `WORK_ORDER_CODE_MAX_ATTEMPTS` 次；
   *   2. **事务级**：并发插入同一编号可能升级为 InnoDB 死锁（1213），
   *      此时整个事务被回滚，由外层 `withTransactionRetry` 重跑，
   *      最多 `TX_MAX_ATTEMPTS` 次、每次退避 `TX_RETRY_BASE_DELAY_MS × 次数`；
   *   两层都超限才返回 30002。
   * - **序号耗尽**：起始序号或重试后超过 999 一律返回 30002，不扩充位数、不绕回覆盖。
   */
  private async insertWorkOrderWithCode(
    manager: EntityManager,
    input: {
      saleOrderId: string;
      productCode: string;
      qty: number;
      createdBy: string;
      today: string;
    },
  ): Promise<{ id: string; code: string }> {
    // 命名锁把「读当日最大序号 + 插入工单」串行化，从源头消除唯一键争用与由此引发的死锁。
    // 临界区只有一条 INSERT，持锁时间极短；finally 保证任何路径都会释放。
    const lockName = `mes:work_order_code:${input.today}`;
    await this.acquireCodeLock(manager, lockName);
    try {
      const usedRows = (await manager.query(
        'SELECT MAX(CAST(SUBSTRING(code, 13, 3) AS UNSIGNED)) AS max_seq FROM work_order WHERE code REGEXP ?',
        [workOrderCodeRegexSource(input.today)],
      )) as Array<{ max_seq: string | number | null }>;

      const rawMax = usedRows[0]?.max_seq;
      const maxSeq = rawMax === null || rawMax === undefined ? 0 : Number(rawMax);
      if (!Number.isFinite(maxSeq) || maxSeq >= WORK_ORDER_MAX_SEQ) {
        throw this.sequenceExhausted(input.today);
      }

      for (let attempt = 0; attempt < WORK_ORDER_CODE_MAX_ATTEMPTS; attempt += 1) {
        const seq = maxSeq + 1 + attempt;
        if (seq > WORK_ORDER_MAX_SEQ) throw this.sequenceExhausted(input.today);

        const code = formatWorkOrderCode(input.today, seq);
        try {
          await manager.insert(WorkOrder, {
            code,
            saleOrderId: input.saleOrderId,
            productCode: input.productCode,
            qty: input.qty,
            doneQty: 0,
            status: WORK_ORDER_STATUS.PENDING,
            planStart: null,
            planEnd: null,
            createdBy: input.createdBy,
          });
          const created = await manager.findOne(WorkOrder, { where: { code } });
          if (!created) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, '工单写入后读取失败');
          }
          return { id: String(created.id), code };
        } catch (error) {
          // 唯一键冲突：换下一个序号重试（其余错误照常抛出 → 事务回滚）
          if (isDuplicateKeyError(error)) continue;
          throw error;
        }
      }

      throw new BusinessException(
        ErrorCode.RESOURCE_CONFLICT,
        `工单编号并发冲突重试 ${WORK_ORDER_CODE_MAX_ATTEMPTS} 次仍未成功，请稍后重试。`,
      );
    } finally {
      await this.releaseCodeLock(manager, lockName);
    }
  }

  /**
   * 获取编号命名锁（MySQL `GET_LOCK`）。
   *
   * 命名锁是**会话级**的，与事务无关：事务回滚不会释放它，因此必须由
   * `releaseCodeLock` 在 `finally` 中显式释放（进程/连接结束时 MySQL 也会自动释放）。
   */
  private async acquireCodeLock(manager: EntityManager, lockName: string): Promise<void> {
    const rows = (await manager.query('SELECT GET_LOCK(?, ?) AS acquired', [
      lockName,
      WORK_ORDER_CODE_LOCK_TIMEOUT_SECONDS,
    ])) as Array<{ acquired: number | string | null }>;

    if (Number(rows[0]?.acquired) !== 1) {
      throw new BusinessException(
        ErrorCode.RESOURCE_CONFLICT,
        `获取工单编号锁超时（${WORK_ORDER_CODE_LOCK_TIMEOUT_SECONDS}s），请稍后重试。`,
      );
    }
  }

  /** 释放编号命名锁；释放失败只记日志，不影响已完成的业务写入 */
  private async releaseCodeLock(manager: EntityManager, lockName: string): Promise<void> {
    try {
      await manager.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    } catch (error) {
      this.logger.warn(
        redactForLog(
          `释放工单编号锁失败（${lockName}）：${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  private sequenceExhausted(today: string): BusinessException {
    return new BusinessException(
      ErrorCode.RESOURCE_CONFLICT,
      `当日工单编号已耗尽（前缀 ${workOrderCodePrefix(today)}，日序号上限 ${WORK_ORDER_MAX_SEQ}），本版不扩充位数、不绕回覆盖，请次日再确认。`,
    );
  }

  /** 组装确认响应（状态取数据库实时派生口径，不靠本地推测） */
  private async buildConfirmationResponse(
    manager: EntityManager,
    order: SaleOrder,
    workOrder: Pick<WorkOrder, 'id' | 'code'>,
    today: string,
  ): Promise<OrderConfirmationResponse> {
    const rows = (await this.readOrderRows(manager, { id: String(order.id) }, today)) as OrderRow[];
    const status = rows[0]?.derived_status ?? order.status;

    const taskCountRows = (await manager.query(
      'SELECT COUNT(*) AS total FROM work_task WHERE work_order_id = ?',
      [String(workOrder.id)],
    )) as Array<{ total: string | number }>;

    const summary: ConfirmationWorkOrderSummary = {
      id: String(workOrder.id),
      code: workOrder.code,
      taskCount: Number(taskCountRows[0]?.total ?? 0),
    };

    return {
      orderId: String(order.id),
      status,
      workOrders: [summary],
      ...DEMO_SOURCE_META,
    };
  }
}

/** 简易退避延时（事务重试用） */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
