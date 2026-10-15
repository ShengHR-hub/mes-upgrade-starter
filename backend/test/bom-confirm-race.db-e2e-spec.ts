import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { IDENTITY_RESOLVER } from '../src/common/auth/identity-resolver.js';
import type { AuthenticatedUser } from '../src/common/auth/identity.types.js';
import { lockProductRow } from '../src/common/utils/product-lock.util.js';
import { BomsService } from '../src/modules/materials/boms.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';

/**
 * S10 复审 P2 修复验证（第二轮）—— **真实 MySQL 多连接并发**。
 *
 * 缺陷回顾：
 * 第一版用会话级命名锁（`GET_LOCK`）串行化「订单确认」与「BOM 写」，
 * 但 `RELEASE_LOCK` 写在事务回调的 `finally` 中，而 TypeORM 在**回调返回之后**才提交，
 * 因此命名锁**未覆盖事务提交点** → 竞态依旧。
 *
 * 本轮修复：两条事务共同锁定**同一持久化 `product` 行**
 * （`SELECT code FROM product WHERE code = ? FOR UPDATE`）。InnoDB 行锁在**事务提交时**才释放，
 * 天然覆盖提交点。
 *
 * 本文件用真实多连接验证：
 *   A. 产品行锁确实互斥（A 未提交 → B 阻塞；A 提交 → B 获得）；
 *   B. **决定性用例**：确认事务未提交时 BOM 删除被阻塞；确认事务提交后，
 *      BOM 删除才继续，并**读到已确认业务 → 30004**（正是复审指出的竞态窗口）；
 *   C. 反向：BOM 持锁时订单确认被阻塞，释放后可进入临界区；
 *   D. 多连接争用：任一时刻只有一个持有者。
 *
 * ⚠️ 认证说明：与既有 db-e2e 相同，通过 DI 覆盖 `IDENTITY_RESOLVER` 注入身份替身；
 *    本套验证的是**并发互斥**，不代表真实 JWT 鉴权已通过（Q4/B9 另见交接文档）。
 *
 * ⚠️ 数据说明：只创建 `BOMRACE-` / `SO-BOMRACE-` 前缀的隔离数据，
 *    `afterAll` 仅按本轮记录的真实 ID 清理。
 *
 * 运行：`DB_PASSWORD="<口令>" npm run test:e2e:db -- bom-confirm-race`
 */

const PRODUCT_PREFIX = 'BOMRACE-';
const RUN = Date.now().toString(36).toUpperCase();
const PRODUCT_CODE = `${PRODUCT_PREFIX}${RUN}`;
const MATERIAL_CODE = `MAT-RACE-${RUN}`;
const ORDER_PREFIX = `SO-BOMRACE-${RUN}-`;
const WO_PREFIX = `WO-BOMRACE-${RUN}-`;

let sequence = 0;
function nextOrderCode(): string {
  sequence += 1;
  return `${ORDER_PREFIX}${sequence}`;
}

function shanghaiDate(offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000 + 8 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let stubUser: AuthenticatedUser | null = { id: '1', role: 'admin', username: 'e2e-admin' };
function asAdmin(): void {
  stubUser = { id: '1', role: 'admin', username: 'e2e-admin' };
}

let app: INestApplication;
let dataSource: DataSource;
let http: ReturnType<typeof request>;

/** 本轮创建的真实 ID（清理范围严格限定于此） */
const createdOrderIds: string[] = [];
const createdBomIds: string[] = [];
const createdProductCodes: string[] = [];
const createdMaterialCodes: string[] = [];

/** 创建一张待确认订单（真实 HTTP），返回真实 ID */
async function createPendingOrder(qty = 10): Promise<string> {
  const code = nextOrderCode();
  const response = await http
    .post('/api/v1/orders')
    .send({ code, productCode: PRODUCT_CODE, qty, dueDate: shanghaiDate(3) })
    .expect(201);
  const id = String(response.body.data.id);
  createdOrderIds.push(id);
  return id;
}

beforeAll(async () => {
  const injectedPassword = process.env.DB_PASSWORD;

  if (injectedPassword === undefined || injectedPassword.length === 0) {
    const diagnosis =
      injectedPassword === undefined
        ? 'process.env.DB_PASSWORD === undefined（变量未出现在 node 进程环境中）'
        : 'process.env.DB_PASSWORD === ""（变量存在但为空字符串）';

    throw new Error(
      [
        '[S10 并发 e2e 无法执行] DB_PASSWORD 不可用。',
        `诊断：${diagnosis}`,
        '本套用例需要**真实 MySQL**（多连接），只创建隔离数据、按本轮真实 ID 清理。',
        '请注入后重跑：DB_PASSWORD="<口令>" npm run test:e2e:db',
        '⚠️ 若数据库尚未授权用于测试，请在交接文档「未验证项」中如实标注本套用例**未执行**，',
        '   不得以替身（mock）结果冒充「真实 MySQL 并发验证通过」。',
      ].join('\n'),
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDENTITY_RESOLVER)
    .useValue({ resolve: () => stubUser })
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  dataSource = app.get(DataSource);
  http = request(app.getHttpServer());
  asAdmin();

  // ---- 准备隔离数据：产品 + 物料 + 一条 BOM ----
  await dataSource.query('INSERT INTO product (code, name, line, unit) VALUES (?, ?, ?, ?)', [
    PRODUCT_CODE,
    `并发验证产品 ${RUN}`,
    '工业控制板卡',
    '台',
  ]);
  createdProductCodes.push(PRODUCT_CODE);

  await dataSource.query('INSERT INTO material (code, name, spec, unit) VALUES (?, ?, ?, ?)', [
    MATERIAL_CODE,
    `并发验证物料 ${RUN}`,
    'E2E',
    '只',
  ]);
  createdMaterialCodes.push(MATERIAL_CODE);

  const created = await http
    .post(`/api/v1/products/${PRODUCT_CODE}/boms`)
    .send({ level: 1, materialCode: MATERIAL_CODE, qty: '2.00', unit: '只' })
    .expect(201);
  createdBomIds.push(String(created.body.data.id));
});

afterAll(async () => {
  if (!dataSource) {
    await app?.close();
    return;
  }

  // 严格按本轮记录的真实 ID 清理，禁止前缀批量删
  if (createdOrderIds.length > 0) {
    const orderPlaceholders = createdOrderIds.map(() => '?').join(',');
    const workOrders = (await dataSource.query(
      `SELECT id FROM work_order WHERE sale_order_id IN (${orderPlaceholders})`,
      createdOrderIds,
    )) as Array<{ id: string | number }>;
    const workOrderIds = workOrders.map((row) => String(row.id));

    const auditTargets = [
      ...createdOrderIds.map((id) => `sale_order:${id}`),
      ...workOrderIds.map((id) => `work_order:${id}`),
    ];
    if (auditTargets.length > 0) {
      const targetPlaceholders = auditTargets.map(() => '?').join(',');
      await dataSource.query(
        `DELETE FROM audit_log WHERE target IN (${targetPlaceholders})`,
        auditTargets,
      );
    }
    if (workOrderIds.length > 0) {
      const woPlaceholders = workOrderIds.map(() => '?').join(',');
      await dataSource.query(
        `DELETE FROM work_task WHERE work_order_id IN (${woPlaceholders})`,
        workOrderIds,
      );
    }
    await dataSource.query(
      `DELETE FROM work_order WHERE sale_order_id IN (${orderPlaceholders})`,
      createdOrderIds,
    );
    await dataSource.query(
      `DELETE FROM sale_order WHERE id IN (${orderPlaceholders})`,
      createdOrderIds,
    );
  }

  if (createdBomIds.length > 0) {
    const bomPlaceholders = createdBomIds.map(() => '?').join(',');
    await dataSource.query(`DELETE FROM bom WHERE id IN (${bomPlaceholders})`, createdBomIds);
  }
  if (createdProductCodes.length > 0) {
    const placeholders = createdProductCodes.map(() => '?').join(',');
    await dataSource.query(
      `DELETE FROM bom WHERE product_code IN (${placeholders})`,
      createdProductCodes,
    );
    await dataSource.query(`DELETE FROM product WHERE code IN (${placeholders})`, createdProductCodes);
  }
  if (createdMaterialCodes.length > 0) {
    const placeholders = createdMaterialCodes.map(() => '?').join(',');
    await dataSource.query(`DELETE FROM material WHERE code IN (${placeholders})`, createdMaterialCodes);
  }

  await app.close();
});

// ================================================================ A. 行锁互斥

describe('A. 产品行锁的互斥性（真实 MySQL 连接级行锁）', () => {
  it('A 持有产品行锁未提交时，B 的 lockProductRow 阻塞；A 提交后 B 获得', async () => {
    const runnerA = dataSource.createQueryRunner();
    const runnerB = dataSource.createQueryRunner();
    await runnerA.connect();
    await runnerB.connect();

    try {
      await runnerA.startTransaction();
      await lockProductRow(runnerA.manager, PRODUCT_CODE);

      await runnerB.startTransaction();
      let bAcquired = false;
      const waitB = lockProductRow(runnerB.manager, PRODUCT_CODE).then(() => {
        bAcquired = true;
      });

      await delay(1_000);
      // 关键：A 未提交 → B 必须仍被阻塞（行锁覆盖到提交点）
      expect(bAcquired).toBe(false);

      await runnerA.commitTransaction();
      await waitB;
      expect(bAcquired).toBe(true);

      await runnerB.commitTransaction();
    } finally {
      await runnerA.rollbackTransaction().catch(() => undefined);
      await runnerB.rollbackTransaction().catch(() => undefined);
      await runnerA.release();
      await runnerB.release();
    }
  }, 30_000);
});

// ================================================================ B. 决定性用例

describe('B. 决定性用例：确认事务未提交 → BOM 删除被阻塞；提交后读到已确认并拒绝', () => {
  it('订单确认事务持锁未提交期间 BOM 删除无法完成；提交后删除返回 30004 且 BOM 行仍在', async () => {
    const bomsService = app.get(BomsService);
    const bomId = createdBomIds[0]!;
    const orderId = await createPendingOrder(10);
    const woCode = `${WO_PREFIX}1`;

    // 手动连接模拟「订单确认事务」：锁订单行 → 锁产品行 → 写工单 → 置订单已确认（**不提交**）
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      await runner.query('SELECT id FROM sale_order WHERE id = ? FOR UPDATE', [orderId]);
      await lockProductRow(runner.manager, PRODUCT_CODE);
      await runner.query(
        'INSERT INTO work_order (code, sale_order_id, product_code, qty) VALUES (?, ?, ?, ?)',
        [woCode, orderId, PRODUCT_CODE, 10],
      );
      await runner.query('UPDATE sale_order SET status = ? WHERE id = ?', ['已确认', orderId]);

      // BOM 删除：应阻塞在产品行锁上，1.5s 内不得 settle
      let settled = false;
      let removalError: { code?: number } | null = null;
      const removal = bomsService
        .remove(bomId, { userId: '1', ip: null })
        .then(() => {
          settled = true;
        })
        .catch((error: { code?: number }) => {
          settled = true;
          removalError = error;
        });

      await delay(1_500);
      // ← 证明行锁覆盖了「未提交」窗口（旧命名锁方案此处会 proceed）
      expect(settled).toBe(false);

      // 提交确认事务（释放产品行锁）
      await runner.commitTransaction();

      await removal;
      // 提交后 BOM 删除才继续，并读到已确认业务 → 引用保护拒绝
      expect(removalError).toMatchObject({ code: 30004 });
    } finally {
      await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }

    // BOM 行必须仍然存在（未被删除）
    const rows = (await dataSource.query('SELECT id FROM bom WHERE id = ?', [bomId])) as Array<{
      id: string | number;
    }>;
    expect(rows.length).toBe(1);
  }, 40_000);
});

// ================================================================ C. 反向

describe('C. 反向：BOM 持产品行锁时，订单确认被阻塞', () => {
  it('BOM 事务持锁期间订单确认阻塞；释放后可进入临界区（不再被锁挡在门外）', async () => {
    const ordersService = app.get(OrdersService);
    const orderId = await createPendingOrder(20);

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      await lockProductRow(runner.manager, PRODUCT_CODE);

      let settled = false;
      let confirmError: { code?: number } | null = null;
      const confirmation = ordersService
        .confirm(orderId, { expectedStatus: '待确认' }, { userId: '1', ip: null })
        .then(() => {
          settled = true;
        })
        .catch((error: { code?: number }) => {
          settled = true;
          confirmError = error;
        });

      await delay(1_000);
      expect(settled).toBe(false); // 被产品行锁阻塞

      await runner.rollbackTransaction(); // 释放行锁

      await confirmation;
      // 本产品无 process_route → 30005（缺少工序明细）；
      // 关键是它**进入了临界区**（若仍被锁阻塞则不会 settle；且不会是锁冲突 30002）。
      const confirmErrorCode = (confirmError as { code?: number } | null)?.code;
      expect(settled).toBe(true);
      expect(confirmError).not.toBeNull();
      expect(confirmErrorCode).not.toBe(30002);
    } finally {
      await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
  }, 40_000);
});

// ================================================================ D. 多连接争用

describe('D. 多连接争用：任一时刻只有一个持有者', () => {
  it('3 条连接同时抢同一产品行锁，1.2s 内恰有 1 个获得', async () => {
    const runners = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const runner = dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        return runner;
      }),
    );

    let acquired = 0;
    const attempts = runners.map((runner) =>
      lockProductRow(runner.manager, PRODUCT_CODE)
        .then(() => {
          acquired += 1;
        })
        .catch(() => undefined),
    );

    try {
      await delay(1_200);
      // 行锁保证任一时刻只有一个持有者
      expect(acquired).toBe(1);
    } finally {
      // 先并发发起全部回滚（持有者先释放，其余依次获得后立即回滚），再等待收敛
      await Promise.allSettled(
        runners.map((runner) => runner.rollbackTransaction().catch(() => undefined)),
      );
      await Promise.allSettled(attempts);
      for (const runner of runners) {
        await runner.release().catch(() => undefined);
      }
    }
  }, 40_000);
});
