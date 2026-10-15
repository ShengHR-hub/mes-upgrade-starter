import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { ProcessRoute } from '../../entities/process-route.entity.js';
import { Product } from '../../entities/product.entity.js';
import { WorkOrder } from '../../entities/work-order.entity.js';

import { OrdersService } from './orders.service.js';

/**
 * 回归背景（S5 审查 P2：「并发创建相同订单号可能返回 500，而非 409/30002」）。
 *
 * 两次预检查都可能查不到编号，随后由 `sale_order.code` 唯一约束兜底；
 * 初版把 `ER_DUP_ENTRY` 直接透传 → 500。本用例在**不依赖数据库**的前提下
 * 用替身 EntityManager 注入该冲突，验证服务层把它转成 30002。
 */
function duplicateKeyError(): Error {
  return Object.assign(new Error("Duplicate entry 'SO-1' for key 'sale_order.code'"), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
  });
}

interface Harness {
  service: OrdersService;
  insert: ReturnType<typeof vi.fn>;
}

function makeHarness(insertImpl: () => Promise<unknown>): Harness {
  const insert = vi.fn(insertImpl);

  const manager = {
    // 预检查：产品存在（否则会先抛 10002）；订单编号查不到（模拟并发下的"都查不到"）
    findOne: async (entity: unknown) =>
      entity === Product ? { code: 'JC-PLC-2001' } : null,
    insert,
  };

  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) => work(manager),
    query: async () => [],
  };

  const audit = { write: async () => undefined };

  return {
    service: new OrdersService(dataSource as never, audit as never),
    insert,
  };
}

const DTO = {
  code: 'SO-1',
  productCode: 'JC-PLC-2001',
  qty: 10,
  dueDate: '2026-10-15',
};
const CONTEXT = { userId: '1', ip: null };

describe('OrdersService.create —— 并发编号冲突必须转成 30002', () => {
  it('插入撞唯一键时返回 30002（而不是把 ER_DUP_ENTRY 透传成 500）', async () => {
    const { service, insert } = makeHarness(async () => {
      throw duplicateKeyError();
    });

    await expect(service.create(DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
      message: '订单编号已存在',
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('非唯一键错误照常抛出（不得被误吞成 30002）', async () => {
    const other = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { service } = makeHarness(async () => {
      throw other;
    });

    await expect(service.create(DTO, CONTEXT)).rejects.toBe(other);
  });

  it('插入成功时正常返回订单（回归：修复不得影响成功路径）', async () => {
    const { service } = makeHarness(async () => ({ identifiers: [{ id: '101' }], raw: {} }));
    // 成功路径会继续读取订单（走 dataSource.query 替身），此处只断言不再抛 30002
    await expect(service.create(DTO, CONTEXT)).rejects.not.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });
});

/**
 * 产品行锁协议（S10 复审 P2 修复 · 第二轮）。
 *
 * 背景：`BomsService.update/remove` 锁 `bom` 行后读 `sale_order`/`work_order`
 * 判断引用保护；`OrdersService.confirm` 锁 `sale_order` 行后插 `work_order`。
 * 两者**无共同加锁资源**，存在「BOM 判定无已确认业务 → 订单确认提交 → BOM 写入成功」的
 * 交错窗口，导致已确认订单对应的 BOM 被改/删。
 *
 * 第一版用会话级 `GET_LOCK`：它在事务回调 `finally` 中提前释放，而 TypeORM 在回调返回后
 * 才提交，**未覆盖事务提交点**，复审认定修复不成立。
 *
 * 现改为：两条事务共同锁定同一 `product` 行
 * （`SELECT code FROM product WHERE code = ? FOR UPDATE`）——InnoDB 行锁在**事务提交时**
 * 才释放，从而覆盖提交点。本组用例断言确认事务在**读取既有工单与任何写入之前**取产品行锁，
 * 且不再出现已废弃的 `GET_LOCK` / `RELEASE_LOCK`。
 */
interface ConfirmHarness {
  service: OrdersService;
  queries: string[];
  /** 会话级命名锁（GET_LOCK）实际使用的锁名，用于回归护栏 */
  lockNames: string[];
}

function makeConfirmHarness(options: {
  order: Record<string, unknown> | null;
  productMissing?: boolean;
  onQuery?: (sql: string, params?: unknown[]) => unknown;
}): ConfirmHarness {
  const queries: string[] = [];
  const lockNames: string[] = [];

  const manager = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      // 产品行锁（锁定读）：默认产品存在；productMissing 时返回空 → 30001
      if (sql.includes('FROM product') && sql.includes('FOR UPDATE')) {
        return options.productMissing ? [] : [{ code: 'JC-PLC-2001' }];
      }
      // 工单编号分配仍使用会话级命名锁（与本次 P2 修复无关），记录锁名以做护栏
      if (sql.includes('GET_LOCK')) {
        lockNames.push(String(params?.[0] ?? ''));
        return [{ acquired: 1 }];
      }
      return options.onQuery ? options.onQuery(sql, params) : [];
    },
    createQueryBuilder: () => {
      // lockOrder 通过 QueryBuilder 加悲观写锁
      queries.push('LOCK_ORDER_FOR_UPDATE');
      const builder = {
        setLock: () => builder,
        where: () => builder,
        getOne: async () => options.order,
      };
      return builder;
    },
    find: async (entity: unknown, opts?: { where?: Record<string, unknown> }) => {
      if (entity === WorkOrder) {
        queries.push('FIND_WORK_ORDER');
        return options.onQuery?.('FIND_WORK_ORDER', [opts]) ?? [];
      }
      if (entity === ProcessRoute) {
        queries.push('FIND_PROCESS_ROUTE');
        return options.onQuery?.('FIND_PROCESS_ROUTE', [opts]) ?? [];
      }
      return [];
    },
    findOne: async () => null,
    insert: async () => ({ identifiers: [{ id: '9001' }], raw: {} }),
    update: async () => ({ affected: 1 }),
  };

  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) => work(manager),
    query: async () => [],
  };
  const audit = { write: async () => undefined };

  return { service: new OrdersService(dataSource as never, audit as never), queries, lockNames };
}

const CONFIRM_DTO = { expectedStatus: 'pending' };
const ORDER_ROW = {
  id: '101',
  code: 'SO-1',
  productCode: 'JC-PLC-2001',
  product_code: 'JC-PLC-2001',
  qty: 10,
  status: 'pending',
};

const isProductLock = (sql: string): boolean =>
  sql.includes('FROM product') && sql.includes('FOR UPDATE');

describe('OrdersService.confirm —— 产品行锁协议（S10 复审 P2 修复 · 第二轮）', () => {
  it('产品行锁在**读取既有工单之前**获取（覆盖提交点的关键顺序）', async () => {
    const { service, queries } = makeConfirmHarness({
      order: { ...ORDER_ROW },
      onQuery: (sql) => {
        if (sql === 'FIND_WORK_ORDER') return [];
        if (sql === 'FIND_PROCESS_ROUTE')
          return [{ seq: 1, stepName: 'SMT 贴片', workshop: 'SMT', prodLine: 'SMT-2线' }];
        if (sql.includes('MAX(CAST')) return [{ max_seq: 0 }];
        if (sql.includes('COUNT(*)')) return [{ total: '1' }];
        return [];
      },
    });

    await service.confirm('101', CONFIRM_DTO, CONTEXT).catch(() => undefined);

    const lockOrderIndex = queries.indexOf('LOCK_ORDER_FOR_UPDATE');
    const productLockIndex = queries.findIndex((sql) => isProductLock(sql));
    const findWorkOrderIndex = queries.findIndex((sql) => sql === 'FIND_WORK_ORDER');

    expect(lockOrderIndex).toBe(0);
    // 产品行锁必须在「锁订单行」之后、「读既有工单」之前
    expect(productLockIndex).toBeGreaterThan(lockOrderIndex);
    expect(findWorkOrderIndex).toBeGreaterThan(productLockIndex);
  });

  it('使用与 BOM 写事务相同的产品行锁语句，且不再使用产品级命名锁', async () => {
    const { service, queries, lockNames } = makeConfirmHarness({
      order: { ...ORDER_ROW },
      onQuery: (sql) => {
        if (sql === 'FIND_WORK_ORDER') return [];
        if (sql === 'FIND_PROCESS_ROUTE')
          return [{ seq: 1, stepName: 'SMT 贴片', workshop: 'SMT', prodLine: 'SMT-2线' }];
        if (sql.includes('MAX(CAST')) return [{ max_seq: 0 }];
        if (sql.includes('COUNT(*)')) return [{ total: '1' }];
        return [];
      },
    });

    await service.confirm('101', CONFIRM_DTO, CONTEXT).catch(() => undefined);

    // 与 BomsService 同源的锁语句（同一持久化产品行）
    const productLocks = queries.filter((sql) => isProductLock(sql));
    expect(productLocks.length).toBe(1);
    expect(productLocks[0]).toContain('SELECT code FROM product WHERE code = ? FOR UPDATE');
    // 回归护栏：不得再使用已废弃的**产品级**命名锁（`mes:bom-product:*`）。
    // 注：工单编号分配仍合法使用 `mes:work_order_code:*` 会话级命名锁（与本次修复无关）。
    expect(lockNames.some((name) => name.startsWith('mes:bom-product:'))).toBe(false);
    expect(lockNames.every((name) => name.startsWith('mes:work_order_code:'))).toBe(true);
  });

  it('既有多张工单 → 30002（回归：修复不得改变既有判定）', async () => {
    const { service } = makeConfirmHarness({
      order: { ...ORDER_ROW },
      onQuery: (sql) => {
        if (sql === 'FIND_WORK_ORDER') return [{ id: '1' }, { id: '2' }];
        return [];
      },
    });

    await expect(service.confirm('101', CONFIRM_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('产品行锁取不到（产品不存在）→ 30001，且不读取既有工单、不建工单', async () => {
    const { service, queries } = makeConfirmHarness({
      order: { ...ORDER_ROW },
      productMissing: true,
      onQuery: () => [],
    });

    await expect(service.confirm('101', CONFIRM_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    expect(queries.some((sql) => sql === 'FIND_WORK_ORDER')).toBe(false);
  });

  it('订单不存在时不取产品行锁（避免无产品可锁却占用行锁）', async () => {
    const { service, queries } = makeConfirmHarness({ order: null });

    await expect(service.confirm('101', CONFIRM_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    expect(queries.some((sql) => isProductLock(sql))).toBe(false);
  });
});
