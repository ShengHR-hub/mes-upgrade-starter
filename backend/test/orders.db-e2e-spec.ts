import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { IDENTITY_RESOLVER } from '../src/common/auth/identity-resolver.js';
import type { AuthenticatedUser } from '../src/common/auth/identity.types.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';

/**
 * S5 端到端自测 —— B1 订单 + B2 工单/工序任务（**需要真实 MySQL**）。
 *
 * ⚠️ 认证说明（重要）：
 * 本套用例通过 **DI 覆盖 `IDENTITY_RESOLVER`** 注入「身份替身」，
 * 本文件保留身份替身以隔离业务测试；真实 JWT 另由 auth.db-e2e-spec.ts 验证。
 * 因此：
 * - 本套用例**验证的是业务逻辑与权限判定**，**不代表真实鉴权已通过**；
 * - 身份替身只存在于本测试进程，**不进入正常启动路径**；
 * - 正常启动路径由 JWT 配置决定是否启用真实认证，未配置时 fail-closed。
 *
 * ⚠️ 数据说明：
 * 只创建带 `SO-S5E2E-` 前缀的隔离演示数据，`afterAll` 仅清理本轮创建的行，
 * 不清空表、不重导全库、不删除既有演示数据。
 */

const CODE_PREFIX = 'SO-S5E2E-';
const RUN = Date.now().toString(36).toUpperCase();
let sequence = 0;

function nextOrderCode(): string {
  sequence += 1;
  return `${CODE_PREFIX}${RUN}-${sequence}`;
}

/** Asia/Shanghai 的日期（offsetDays 为天数偏移） */
function shanghaiDate(offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000 + 8 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

function compact(dateOnly: string): string {
  return dateOnly.replace(/-/g, '');
}

let stubUser: AuthenticatedUser | null = { id: '1', role: 'admin', username: 'e2e-admin' };

let app: INestApplication;
let dataSource: DataSource;
let http: ReturnType<typeof request>;

/** 本轮创建的脏数据 / 边界数据，供清理使用 */
const extraWorkOrderCodes: string[] = [];

/**
 * 本轮通过 API 真实创建的订单 ID（BIGINT 十进制字符串）。
 * `afterAll` **只**按这份清单清理，确保「仅清理本轮创建的数据」。
 */
const createdOrderIds: string[] = [];

function asAdmin(): void {
  stubUser = { id: '1', role: 'admin', username: 'e2e-admin' };
}
function asManager(): void {
  stubUser = { id: '2', role: 'manager', username: 'e2e-manager' };
}
function asOperator(): void {
  stubUser = { id: '3', role: 'operator', username: 'e2e-operator' };
}
function asAnonymous(): void {
  stubUser = null;
}

async function createOrder(
  productCode = 'JC-PLC-2001',
  qty = 100,
  dueDate = shanghaiDate(5),
): Promise<{ id: string; code: string }> {
  const code = nextOrderCode();
  const response = await http
    .post('/api/v1/orders')
    .send({ code, productCode, qty, dueDate })
    .expect(201);
  expect(response.body.code).toBe(0);
  const id = String(response.body.data.id);
  // 记录本轮创建的订单 ID —— afterAll 的清理范围严格以此为准
  createdOrderIds.push(id);
  return { id, code };
}

/** 返回 supertest 请求对象（**不能**声明为 async，否则调用方无法链式 `.expect()`） */
function confirmOrder(id: string, expectedStatus = '待确认') {
  return http.post(`/api/v1/orders/${id}/confirmations`).send({ expectedStatus });
}

beforeAll(async () => {
  const injectedPassword = process.env.DB_PASSWORD;

  if (injectedPassword === undefined || injectedPassword.length === 0) {
    // 自证式诊断：区分「变量根本没传进来」与「传进来但是空串」，避免只看到一句"缺少口令"。
    // ⚠️ 只报告状态与长度，**绝不回显口令内容**。
    const diagnosis =
      injectedPassword === undefined
        ? 'process.env.DB_PASSWORD === undefined（变量未出现在 node 进程环境中）'
        : 'process.env.DB_PASSWORD === ""（变量存在但为空字符串）';

    throw new Error(
      [
        '[S5 e2e 无法执行] DB_PASSWORD 不可用。',
        `诊断：${diagnosis}`,
        '注：`backend/.env` 中有一行 `DB_PASSWORD=`（空值），Vite 会把它加载进 process.env，',
        '    因此「未在会话中注入口令」时这里通常表现为**空字符串**而不是 undefined；',
        '    在会话中已注入时，注入值会覆盖该空值（口令只从进程环境变量注入，不落盘）。',
        '常见原因：',
        '  ① 未在**同一个** PowerShell 会话里先注入变量、再调用 npm（新开窗口 / 分段粘贴会丢失）；',
        '  ② 交互式输入口令时直接回车，或输入到了别的位置；',
        '  ③ 在 Windows PowerShell 5.1 中执行 —— `ConvertFrom-SecureString -AsPlainText` 是 PowerShell 7 专有参数；',
        '  ④ 口令含特殊字符被 shell 解析（改用 `Read-Host -AsSecureString` 交互注入可规避）。',
        '请注入后重跑：DB_PASSWORD="<口令>" npm run test:e2e:db',
        '在未注入口令的环境下，本套用例不会以 mock 结果冒充「端到端通过」。',
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
});

afterAll(async () => {
  if (!dataSource) {
    await app?.close();
    return;
  }

  // ⚠️ 清理范围必须严格限定为「本轮创建的行」：
  // 用 `createdOrderIds`（每次 createOrder 成功时记录的真实 ID）精确删除，
  // **不能**按 `code LIKE 'SO-S5E2E-%'` 批量删 —— 那样会误删其它并发运行的
  // 测试进程（不同 RUN 段）或历史遗留记录，超出「仅清理本轮」的声明。
  // 修复记录：2026-10-10 S5 审查意见「数据库测试清理范围越界」。
  const orderIds = [...new Set(createdOrderIds)];

  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    const workOrders = (await dataSource.query(
      `SELECT id FROM work_order WHERE sale_order_id IN (${placeholders})`,
      orderIds,
    )) as Array<{ id: string | number }>;
    const workOrderIds = workOrders.map((row) => String(row.id));

    const taskRows = workOrderIds.length > 0 ? await dataSource.query(
      `SELECT id FROM work_task WHERE work_order_id IN (${workOrderIds.map(() => '?').join(',')})`, workOrderIds,
    ) as Array<{ id: string }> : [];
    // 先删审计（它引用业务对象的字符串形式，必须在业务行删除前处理）
    const auditTargets = [
      ...taskRows.map((row) => `work_task:${row.id}`),
      ...orderIds.map((id) => `sale_order:${id}`),
      ...workOrderIds.map((id) => `work_order:${id}`),
    ];
    if (auditTargets.length > 0) {
      const auditPlaceholders = auditTargets.map(() => '?').join(',');
      await dataSource.query(`DELETE FROM audit_log WHERE target IN (${auditPlaceholders})`, auditTargets);
    }

    if (workOrderIds.length > 0) {
      const woPlaceholders = workOrderIds.map(() => '?').join(',');
      await dataSource.query(
        `DELETE FROM work_task WHERE work_order_id IN (${woPlaceholders})`,
        workOrderIds,
      );
    }
    await dataSource.query(`DELETE FROM work_order WHERE sale_order_id IN (${placeholders})`, orderIds);
    await dataSource.query(`DELETE FROM sale_order WHERE id IN (${placeholders})`, orderIds);
  }

  // 脏数据工单（`S5E2E-DIRTY-*-<RUN>`，不属于任何订单）按本轮记录的编号精确删除
  if (extraWorkOrderCodes.length > 0) {
    const placeholders = extraWorkOrderCodes.map(() => '?').join(',');
    const rows = (await dataSource.query(
      `SELECT id FROM work_order WHERE code IN (${placeholders})`,
      extraWorkOrderCodes,
    )) as Array<{ id: string | number }>;
    const ids = rows.map((row) => String(row.id));
    if (ids.length > 0) {
      const idPlaceholders = ids.map(() => '?').join(',');
      await dataSource.query(`DELETE FROM work_task WHERE work_order_id IN (${idPlaceholders})`, ids);
      await dataSource.query(`DELETE FROM work_order WHERE id IN (${idPlaceholders})`, ids);
    }
  }

  await app.close();
});

// ================================================================ A. 正常闭环

describe('A. 正常闭环（创建 → 编辑 → 确认）', () => {
  it('确认后恰好 1 张工单、10 道工序任务，且任务字段与真实工艺路线逐项一致', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 100, shanghaiDate(5));

    // 编辑待确认订单
    const patched = await http
      .patch(`/api/v1/orders/${order.id}`)
      .send({ qty: 120, dueDate: shanghaiDate(7) })
      .expect(200);
    expect(patched.body.data.qty).toBe(120);
    expect(patched.body.data.status).toBe('待确认');

    const response = await confirmOrder(order.id).expect(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.orderId).toBe(order.id);
    expect(response.body.data.status).toBe('已确认');
    expect(response.body.data.workOrders).toHaveLength(1);
    expect(response.body.data.workOrders[0].taskCount).toBe(10);
    expect(response.body.data.workOrders[0].code).toMatch(/^WO-\d{8}-\d{3}$/);

    // 数据库侧：唯一工单 + 10 任务
    const workOrders = (await dataSource.query(
      'SELECT id, code, product_code, qty, status, plan_start, plan_end FROM work_order WHERE sale_order_id = ?',
      [order.id],
    )) as Array<Record<string, unknown>>;
    expect(workOrders).toHaveLength(1);
    expect(workOrders[0].product_code).toBe('JC-PLC-2001');
    expect(Number(workOrders[0].qty)).toBe(120);
    expect(workOrders[0].status).toBe('待启动');
    expect(workOrders[0].plan_start).toBeNull();
    expect(workOrders[0].plan_end).toBeNull();

    // 任务逐项与 process_route 对齐
    const routes = (await dataSource.query(
      'SELECT seq, step_name, workshop, prod_line FROM process_route WHERE product_code = ? ORDER BY seq ASC',
      ['JC-PLC-2001'],
    )) as Array<Record<string, unknown>>;
    expect(routes).toHaveLength(10);

    const tasksResponse = await http
      .get(`/api/v1/work-orders/${String(workOrders[0].id)}/tasks?page=1&pageSize=100`)
      .expect(200);
    const tasks = tasksResponse.body.data.list as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(10);

    for (const [index, route] of routes.entries()) {
      const task = tasks[index]!;
      expect(task.seq).toBe(Number(route.seq));
      expect(task.stepName).toBe(route.step_name);
      expect(task.workshop).toBe(route.workshop);
      expect(task.prodLine).toBe(route.prod_line);
      expect(task.planQty).toBe(120); // planQty = 工单 qty
      expect(task.goodQty).toBe(0);
      expect(task.badQty).toBe(0);
      expect(task.status).toBe('待启动');
      // key_device 是描述字段，不得被自动当作 deviceCode 外键
      expect(task.deviceCode).toBeNull();
      expect(task.operatorId).toBeNull();
    }

    // 审计与业务同事务写入
    const audits = (await dataSource.query(
      'SELECT action, target, user_id FROM audit_log WHERE target IN (?, ?) ORDER BY id ASC',
      [`sale_order:${order.id}`, `work_order:${String(workOrders[0].id)}`],
    )) as Array<Record<string, unknown>>;
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('创建订单');
    expect(actions).toContain('修改订单');
    expect(actions).toContain('确认订单');
    expect(audits.every((row) => String(row.user_id) === '1')).toBe(true);
  });

  it('列表与详情使用同一状态口径；响应携带演示数据标识', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(3));

    const detail = await http.get(`/api/v1/orders/${order.id}`).expect(200);
    expect(detail.body.data.status).toBe('待确认');
    expect(detail.body.data.dataSource).toBe('demo');
    expect(detail.body.data.dataLabel).toBe('演示数据');

    const list = await http
      .get(`/api/v1/orders?page=1&pageSize=100&keyword=${order.code}`)
      .expect(200);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.list[0].status).toBe(detail.body.data.status);
  });
});

// ================================================================ B. 原子性与并发

describe('B. 原子性与并发', () => {
  it('重复确认返回现有唯一工单，工单号与任务数不变', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 50, shanghaiDate(4));

    const first = await confirmOrder(order.id).expect(200);
    const firstCode = first.body.data.workOrders[0].code;

    const second = await confirmOrder(order.id).expect(200);
    expect(second.body.data.workOrders).toHaveLength(1);
    expect(second.body.data.workOrders[0].code).toBe(firstCode);
    expect(second.body.data.workOrders[0].taskCount).toBe(10);
    expect(second.body.data.status).toBe('已确认');

    const rows = (await dataSource.query('SELECT COUNT(*) AS total FROM work_order WHERE sale_order_id = ?', [
      order.id,
    ])) as Array<{ total: string | number }>;
    expect(Number(rows[0]!.total)).toBe(1);
  });

  it('同一订单并发确认：只生成 1 张工单、10 道任务', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 30, shanghaiDate(6));

    const responses = await Promise.all([
      confirmOrder(order.id),
      confirmOrder(order.id),
      confirmOrder(order.id),
    ]);

    for (const [index, response] of responses.entries()) {
      // 失败时把完整响应打出来，避免只看到 "Cannot read properties of null"
      expect(
        response.body.code,
        `第 ${index + 1} 次并发确认失败：${JSON.stringify(response.body)}`,
      ).toBe(0);
      expect(response.body.data.workOrders).toHaveLength(1);
    }
    const codes = new Set(responses.map((item) => item.body.data.workOrders[0].code));
    expect(codes.size).toBe(1);

    const workOrders = (await dataSource.query(
      'SELECT id FROM work_order WHERE sale_order_id = ?',
      [order.id],
    )) as Array<{ id: string | number }>;
    expect(workOrders).toHaveLength(1);
    const taskRows = (await dataSource.query(
      'SELECT COUNT(*) AS total FROM work_task WHERE work_order_id = ?',
      [String(workOrders[0]!.id)],
    )) as Array<{ total: string | number }>;
    expect(Number(taskRows[0]!.total)).toBe(10);
  });

  it('不同订单并发确认：工单编号不重复', async () => {
    asAdmin();
    const orders = [];
    for (let index = 0; index < 4; index += 1) {
      orders.push(await createOrder('JC-PLC-2001', 5, shanghaiDate(8)));
    }

    const responses = await Promise.all(orders.map((order) => confirmOrder(order.id)));
    for (const [index, response] of responses.entries()) {
      // 失败时把完整响应打出来，避免只看到 "Cannot read properties of null"
      expect(
        response.body.code,
        `订单 ${orders[index]!.code} 并发确认失败：${JSON.stringify(response.body)}`,
      ).toBe(0);
    }
    const codes = responses.map((item) => item.body.data.workOrders[0].code as string);

    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^WO-\d{8}-\d{3}$/);
      expect(code).toContain(compact(shanghaiDate(0)));
    }
  });

  it('并发创建相同订单号：一个 201、一个 409/30002，绝不 500', async () => {
    asAdmin();
    const code = nextOrderCode();
    const payload = { code, productCode: 'JC-PLC-2001', qty: 10, dueDate: shanghaiDate(5) };

    const responses = await Promise.all([
      http.post('/api/v1/orders').send(payload),
      http.post('/api/v1/orders').send(payload),
    ]);

    // 立刻登记本轮创建的订单 ID —— 即使后续断言失败，afterAll 也能精确清理
    const rows = (await dataSource.query('SELECT id FROM sale_order WHERE code = ?', [
      code,
    ])) as Array<{ id: string | number }>;
    for (const row of rows) createdOrderIds.push(String(row.id));

    // 修复记录（审查 P2）：初版两次预检查都可能查不到编号，
    // 随后 ER_DUP_ENTRY 直接透传 → 500。现在必须转成 409/30002。
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses, JSON.stringify(responses.map((r) => r.body))).toEqual([201, 409]);

    const conflict = responses.find((response) => response.status === 409)!;
    expect(conflict.body.code).toBe(30002);
    expect(rows).toHaveLength(1); // 数据库只落一条
  });

  it('无工艺明细：整个事务回滚（订单仍待确认，无工单、无任务、无审计）', async () => {
    asAdmin();
    // JC-IoT-4G-A 有 BOM 但没有 process_route 明细
    const order = await createOrder('JC-IoT-4G-A', 20, shanghaiDate(5));

    const response = await confirmOrder(order.id).expect(422);
    expect(response.body.code).toBe(30005);

    const orderRows = (await dataSource.query('SELECT status FROM sale_order WHERE id = ?', [
      order.id,
    ])) as Array<{ status: string }>;
    expect(orderRows[0]!.status).toBe('待确认');

    const woRows = (await dataSource.query('SELECT COUNT(*) AS total FROM work_order WHERE sale_order_id = ?', [
      order.id,
    ])) as Array<{ total: string | number }>;
    expect(Number(woRows[0]!.total)).toBe(0);

    const auditRows = (await dataSource.query(
      "SELECT COUNT(*) AS total FROM audit_log WHERE target = ? AND action = '确认订单'",
      [`sale_order:${order.id}`],
    )) as Array<{ total: string | number }>;
    expect(Number(auditRows[0]!.total)).toBe(0);
  });

  it('受控注入「任务写入失败」：全部回滚', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 15, shanghaiDate(5));

    const ordersService = app.get(OrdersService);
    const spy = vi
      .spyOn(ordersService as unknown as { insertTasks: () => Promise<void> }, 'insertTasks')
      .mockRejectedValueOnce(new Error('injected task write failure'));

    await confirmOrder(order.id).expect(500);
    spy.mockRestore();

    const orderRows = (await dataSource.query('SELECT status FROM sale_order WHERE id = ?', [
      order.id,
    ])) as Array<{ status: string }>;
    expect(orderRows[0]!.status).toBe('待确认');

    const woRows = (await dataSource.query('SELECT COUNT(*) AS total FROM work_order WHERE sale_order_id = ?', [
      order.id,
    ])) as Array<{ total: string | number }>;
    expect(Number(woRows[0]!.total)).toBe(0);
  });

  it('受控注入「审计写入失败」：全部回滚', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 15, shanghaiDate(5));

    const auditService = app.get(AuditService);
    const spy = vi.spyOn(auditService, 'write').mockRejectedValueOnce(new Error('injected audit failure'));

    await confirmOrder(order.id).expect(500);
    spy.mockRestore();

    const orderRows = (await dataSource.query('SELECT status FROM sale_order WHERE id = ?', [
      order.id,
    ])) as Array<{ status: string }>;
    expect(orderRows[0]!.status).toBe('待确认');

    const woRows = (await dataSource.query('SELECT COUNT(*) AS total FROM work_order WHERE sale_order_id = ?', [
      order.id,
    ])) as Array<{ total: string | number }>;
    expect(Number(woRows[0]!.total)).toBe(0);
  });

  it('订单已关联多张工单（脏数据）：返回 30002，不删数据、不任选一张', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));

    // 受控构造脏数据：直接写入 2 张工单
    const dirtyCodes = [`S5E2E-DIRTY-A-${RUN}`, `S5E2E-DIRTY-B-${RUN}`];
    for (const code of dirtyCodes) {
      await dataSource.query(
        'INSERT INTO work_order (code, sale_order_id, product_code, qty, done_qty, status) VALUES (?, ?, ?, ?, 0, ?)',
        [code, order.id, 'JC-PLC-2001', 10, '待启动'],
      );
      extraWorkOrderCodes.push(code);
    }

    const response = await confirmOrder(order.id).expect(409);
    expect(response.body.code).toBe(30002);

    const rows = (await dataSource.query('SELECT COUNT(*) AS total FROM work_order WHERE sale_order_id = ?', [
      order.id,
    ])) as Array<{ total: string | number }>;
    expect(Number(rows[0]!.total)).toBe(2); // 未被删除
  });

  it('当日工单序号耗尽（已用 999）：返回 30002，不扩充位数、不绕回覆盖', async () => {
    asAdmin();
    const today = shanghaiDate(0);
    const boundaryCode = `WO-${compact(today)}-999`;

    // ⚠️ 修复记录（审查 P2：「编号耗尽用例可未执行验收断言却计为 passed」）：
    // 初版在 `-999` 已存在时只断言"存在"就 `return`，等于**跳过全部验收断言却仍记为通过**。
    // 现在的做法：**无论该行是否由本轮创建，都完整执行验收断言** ——
    // 因为只要当日序号已是 999，下一次确认就必然返回 30002，两种情形的预期完全一致。
    // 差异只在清理：只有本轮创建的行才删除，绝不动他人数据。
    const existing = (await dataSource.query('SELECT id FROM work_order WHERE code = ?', [
      boundaryCode,
    ])) as unknown[];
    const createdByThisRun = existing.length === 0;

    if (createdByThisRun) {
      await dataSource.query(
        'INSERT INTO work_order (code, sale_order_id, product_code, qty, done_qty, status) VALUES (?, NULL, ?, 1, 0, ?)',
        [boundaryCode, 'JC-PLC-2001', '待启动'],
      );
    }

    try {
      // —— 以下验收断言在两种情形下都必须执行 ——
      const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
      const response = await confirmOrder(order.id).expect(409);
      expect(response.body.code).toBe(30002);
      expect(response.body.message).toContain('耗尽');

      // 事务整体回滚：订单仍为待确认，且没有生成任何工单
      const orderRows = (await dataSource.query('SELECT status FROM sale_order WHERE id = ?', [
        order.id,
      ])) as Array<{ status: string }>;
      expect(orderRows[0]!.status).toBe('待确认');

      const generated = (await dataSource.query(
        'SELECT COUNT(*) AS total FROM work_order WHERE sale_order_id = ?',
        [order.id],
      )) as Array<{ total: string | number }>;
      expect(Number(generated[0]!.total)).toBe(0);
    } finally {
      // 只删本轮创建的行；且必须立即删除，否则当日序号仍是 999，会污染其后的确认用例
      if (createdByThisRun) {
        await dataSource.query('DELETE FROM work_order WHERE code = ?', [boundaryCode]);
      }
    }
  });
});

// ================================================================ C. 校验与状态

describe('C. 校验与状态', () => {
  it('重复订单号 → 30002', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    const response = await http
      .post('/api/v1/orders')
      .send({ code: order.code, productCode: 'JC-PLC-2001', qty: 10, dueDate: shanghaiDate(5) })
      .expect(409);
    expect(response.body.code).toBe(30002);
  });

  it('无效产品 → 10002', async () => {
    asAdmin();
    const response = await http
      .post('/api/v1/orders')
      .send({ code: nextOrderCode(), productCode: 'NOT-EXIST', qty: 10, dueDate: shanghaiDate(5) })
      .expect(400);
    expect(response.body.code).toBe(10002);
  });

  it('非法数量 → 10001（0 / 负数 / 字符串 / 超 INT 上限）', async () => {
    asAdmin();
    for (const qty of [0, -1, '100', 2147483648]) {
      const response = await http
        .post('/api/v1/orders')
        .send({ code: nextOrderCode(), productCode: 'JC-PLC-2001', qty, dueDate: shanghaiDate(5) })
        .expect(400);
      expect(response.body.code, `qty=${String(qty)}`).toBe(10001);
    }
  });

  it('确认接口只接受契约值 expectedStatus="待确认"，其余取值 → 10001', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));

    // 契约 §6.2 把该字段限定为字面量 "待确认"；初版误用全量订单枚举，放行了这些取值
    for (const expectedStatus of ['已完成', '已确认', '生产中', '已延期', 'anything']) {
      const response = await http
        .post(`/api/v1/orders/${order.id}/confirmations`)
        .send({ expectedStatus })
        .expect(400);
      expect(response.body.code, expectedStatus).toBe(10001);
    }

    // 契约值仍可用；上述非法请求不得产生任何副作用
    const confirmed = await confirmOrder(order.id).expect(200);
    expect(confirmed.body.data.status).toBe('已确认');
    expect(confirmed.body.data.workOrders).toHaveLength(1);
  });

  it('PATCH 订单拒绝非法 null → 10001（契约未开放 null，不得落到数据库 NOT NULL 才报 500）', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));

    for (const payload of [{ qty: null }, { productCode: null }, { dueDate: null }]) {
      const response = await http.patch(`/api/v1/orders/${order.id}`).send(payload).expect(400);
      expect(response.body.code, JSON.stringify(payload)).toBe(10001);
      const fields = (response.body.data.errors as Array<{ field: string }>).map((item) => item.field);
      expect(fields).toContain(Object.keys(payload)[0]);
    }

    // 订单未被任何一次非法请求改动
    const detail = await http.get(`/api/v1/orders/${order.id}`).expect(200);
    expect(detail.body.data.qty).toBe(10);
    expect(detail.body.data.productCode).toBe('JC-PLC-2001');
    expect(detail.body.data.status).toBe('待确认');
  });

  it('非法日期 → 10001（不存在的日历日 / 错误格式）', async () => {
    asAdmin();
    for (const dueDate of ['2026-02-31', '2026-13-01', '2026/10/10', '2026-10-10T00:00:00+08:00']) {
      const response = await http
        .post('/api/v1/orders')
        .send({ code: nextOrderCode(), productCode: 'JC-PLC-2001', qty: 10, dueDate })
        .expect(400);
      expect(response.body.code, dueDate).toBe(10001);
    }
  });

  it('未知字段被拒绝 → 10001（含客户端试图指定 createdBy / status）', async () => {
    asAdmin();
    const response = await http
      .post('/api/v1/orders')
      .send({
        code: nextOrderCode(),
        productCode: 'JC-PLC-2001',
        qty: 10,
        dueDate: shanghaiDate(5),
        createdBy: '999',
        status: '已确认',
      })
      .expect(400);
    expect(response.body.code).toBe(10001);
    const fields = (response.body.data.errors as Array<{ field: string }>).map((item) => item.field);
    expect(fields).toContain('createdBy');
    expect(fields).toContain('status');
  });

  it('非法分页 → 10001', async () => {
    asAdmin();
    for (const query of ['page=abc', 'pageSize=0', 'pageSize=101', 'pageSize[]=10']) {
      const response = await http.get(`/api/v1/orders?${query}`).expect(400);
      expect(response.body.code, query).toBe(10001);
    }
  });

  it('大 ID 不丢精度：字符串原样返回 / 不存在的 ID → 30001', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    const detail = await http.get(`/api/v1/orders/${order.id}`).expect(200);
    expect(typeof detail.body.data.id).toBe('string');
    expect(detail.body.data.id).toBe(order.id);

    const missing = await http.get('/api/v1/orders/9007199254740993').expect(404);
    expect(missing.body.code).toBe(30001);
  });

  it('非待确认订单不可编辑 → 30003；工单计划仅待启动可改', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    await confirmOrder(order.id).expect(200);

    const patch = await http.patch(`/api/v1/orders/${order.id}`).send({ qty: 99 }).expect(409);
    expect(patch.body.code).toBe(30003);

    const list = await http
      .get(`/api/v1/work-orders?page=1&pageSize=10&saleOrderId=${order.id}`)
      .expect(200);
    const workOrderId = String(list.body.data.list[0].id);

    // 待启动：允许设置计划
    const planOk = await http
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ planStart: shanghaiDate(1), planEnd: shanghaiDate(6) })
      .expect(200);
    expect(planOk.body.data.planStart).toBe(shanghaiDate(1));
    expect(planOk.body.data.planEnd).toBe(shanghaiDate(6));

    // 起日 > 止日 → 10001
    const badPlan = await http
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ planStart: shanghaiDate(9) })
      .expect(400);
    expect(badPlan.body.code).toBe(10001);

    // 流转到在产后不可再改计划
    await http
      .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '待启动', targetStatus: '在产' })
      .expect(200);
    const locked = await http
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ planEnd: shanghaiDate(9) })
      .expect(409);
    expect(locked.body.code).toBe(30003);
  });

  it('状态判定与筛选口径一致（当天不算延期 / 次日延期 / 已完工 / 在产超期）', async () => {
    asAdmin();
    const today = shanghaiDate(0);
    const yesterday = shanghaiDate(-1);

    // 1) 无关联工单 + 到期日=当天 → 待确认（不算延期）
    const dueToday = await createOrder('JC-PLC-2001', 10, today);
    expect((await http.get(`/api/v1/orders/${dueToday.id}`)).body.data.status).toBe('待确认');

    // 2) 无关联工单 + 已超期 → 已延期（空集合不算完成）
    const overdue = await createOrder('JC-PLC-2001', 10, yesterday);
    expect((await http.get(`/api/v1/orders/${overdue.id}`)).body.data.status).toBe('已延期');

    // 3) 确认后工单在产 + 超期 → 已延期
    const overdueInProduction = await createOrder('JC-PLC-2001', 10, yesterday);
    await confirmOrder(overdueInProduction.id).expect(200);
    const woList = await http
      .get(`/api/v1/work-orders?page=1&pageSize=10&saleOrderId=${overdueInProduction.id}`)
      .expect(200);
    const woId = String(woList.body.data.list[0].id);
    await http
      .post(`/api/v1/work-orders/${woId}/state-transitions`)
      .send({ expectedStatus: '待启动', targetStatus: '在产' })
      .expect(200);
    expect((await http.get(`/api/v1/orders/${overdueInProduction.id}`)).body.data.status).toBe('已延期');

    // 4) 工单完工 → 订单已完成（即使超期）
    await http
      .post(`/api/v1/work-orders/${woId}/state-transitions`)
      .send({ expectedStatus: '在产', targetStatus: '完工' })
      .expect(200);
    expect((await http.get(`/api/v1/orders/${overdueInProduction.id}`)).body.data.status).toBe('已完成');

    // 5) 筛选与详情同口径
    const delayedList = await http
      .get('/api/v1/orders?page=1&pageSize=100&status=已延期&dueDateFrom=2000-01-01&dueDateTo=2000-01-02')
      .expect(200);
    expect(delayedList.body.data.total).toBe(0); // 日期范围排除本轮数据，验证筛选条件确实生效

    const completedList = await http
      .get('/api/v1/orders?page=1&pageSize=100&status=已完成')
      .expect(200);
    const ids = (completedList.body.data.list as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toContain(overdueInProduction.id);
    expect(ids).not.toContain(dueToday.id);
  });

  it('非法流转和过期 expectedStatus → 30003；批准的暂停/恢复/关闭可用', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    await confirmOrder(order.id).expect(200);
    const list = await http
      .get(`/api/v1/work-orders?page=1&pageSize=10&saleOrderId=${order.id}`)
      .expect(200);
    const workOrderId = String(list.body.data.list[0].id);

    const blocked = await http
      .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '待启动', targetStatus: '暂停' })
      .expect(409);
    expect(blocked.body.code).toBe(30003);

    // 跳步（待启动 → 完工）属于非法流转 → 30003
    const skipped = await http
      .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '待启动', targetStatus: '完工' })
      .expect(409);
    expect(skipped.body.code).toBe(30003);

    // expectedStatus 不匹配 → 30003
    const mismatch = await http
      .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '在产', targetStatus: '完工' })
      .expect(409);
    expect(mismatch.body.code).toBe(30003);
    for (const [from, to] of [['待启动', '在产'], ['在产', '暂停'], ['暂停', '在产'], ['在产', '暂停'], ['暂停', '关闭']]) {
      const response = await http.post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
        .send({ expectedStatus: from, targetStatus: to }).expect(200);
      expect(response.body.data.status).toBe(to);
    }
    expect((await http.get(`/api/v1/orders/${order.id}`).expect(200)).body.data.status).not.toBe('已完成');
    expect((await http.post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '关闭', targetStatus: '在产' }).expect(409)).body.code).toBe(30003);
  });

  it('批准的任务计划、清空分配与顺序前置；非法请求不写入', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    await confirmOrder(order.id).expect(200);
    const list = await http.get(`/api/v1/work-orders?saleOrderId=${order.id}`).expect(200);
    const workOrderId = String(list.body.data.list[0].id);
    const tasks = await http.get(`/api/v1/work-orders/${workOrderId}/tasks?pageSize=100`).expect(200);
    const ordered = [...tasks.body.data.list].sort((a, b) => a.seq - b.seq);
    expect(ordered.length).toBeGreaterThan(1);
    const taskId = String(ordered[0].id);
    const secondId = String(ordered[1].id);
    const snapshot = () => dataSource.query('SELECT status, device_code, operator_id, plan_start, plan_end FROM work_task WHERE id = ?', [taskId]);
    const before = await snapshot();
    expect((await http.patch(`/api/v1/tasks/${taskId}`)
      .send({ deviceCode: `NO-S12-${RUN}` }).expect(400)).body.code).toBe(10002);
    expect(await snapshot()).toEqual(before);
    const planStart = `${shanghaiDate(1)}T08:00:00+08:00`;
    const planEnd = `${shanghaiDate(1)}T17:00:00+08:00`;
    expect((await http.patch(`/api/v1/tasks/${taskId}`)
      .send({ deviceCode: null, operatorId: null, planStart, planEnd }).expect(200)).body.code).toBe(0);
    const planned = await snapshot();
    expect(planned[0].plan_start).not.toBeNull();
    expect(planned[0].device_code).toBeNull();
    expect(planned[0].operator_id).toBeNull();
    expect((await http.patch(`/api/v1/tasks/${taskId}`)
      .send({ planStart: `${shanghaiDate(2)}T08:00:00+08:00` }).expect(400)).body.code).toBe(10001);
    expect(await snapshot()).toEqual(planned);
    const transition = (id: string, from: string, to: string) => http.post(`/api/v1/tasks/${id}/state-transitions`)
      .send({ expectedStatus: from, targetStatus: to });
    expect((await transition(secondId, '待启动', '在产').expect(409)).body.code).toBe(30003);
    await transition(taskId, '待启动', '在产').expect(200);
    await transition(taskId, '在产', '完工').expect(200);
    await transition(secondId, '待启动', '在产').expect(200);
    expect((await snapshot())[0].status).toBe('完工');
    expect((await http.patch('/api/v1/tasks/999999999').send({ prodLine: 'SMT-1' }).expect(404)).body.code).toBe(30001);
  });

  it('工单状态主线仍可用（契约 §6.3 需求已确定），且完工后订单转为已完成', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    await confirmOrder(order.id).expect(200);
    const woList = await http
      .get(`/api/v1/work-orders?page=1&pageSize=10&saleOrderId=${order.id}`)
      .expect(200);
    const workOrderId = String(woList.body.data.list[0].id);

    const started = await http
      .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '待启动', targetStatus: '在产' })
      .expect(200);
    expect(started.body.data.status).toBe('在产');

    const finished = await http
      .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
      .send({ expectedStatus: '在产', targetStatus: '完工' })
      .expect(200);
    expect(finished.body.data.status).toBe('完工');

    const detail = await http.get(`/api/v1/orders/${order.id}`).expect(200);
    expect(detail.body.data.status).toBe('已完成');
  });

  it('不存在的资源 → 30001（订单 / 工单 / 任务）', async () => {
    asAdmin();
    expect((await http.get('/api/v1/orders/999999999').expect(404)).body.code).toBe(30001);
    expect((await http.get('/api/v1/work-orders/999999999').expect(404)).body.code).toBe(30001);
    expect((await http.get('/api/v1/tasks/999999999').expect(404)).body.code).toBe(30001);
  });
});

// ================================================================ D. 权限

describe('D. 权限（契约 §5.2）', () => {
  it('匿名请求一律 401（fail-closed，不允许匿名创建 / 修改 / 确认订单）', async () => {
    asAnonymous();
    try {
      expect((await http.get('/api/v1/orders').expect(401)).body.code).toBe(20001);
      expect(
        (
          await http
            .post('/api/v1/orders')
            .send({ code: nextOrderCode(), productCode: 'JC-PLC-2001', qty: 1, dueDate: shanghaiDate(5) })
            .expect(401)
        ).body.code,
      ).toBe(20001);
      expect((await http.post('/api/v1/orders/1/confirmations').send({ expectedStatus: '待确认' }).expect(401)).body.code).toBe(20001);
      expect((await http.get('/api/v1/work-orders').expect(401)).body.code).toBe(20001);
      expect((await http.get('/api/v1/products').expect(401)).body.code).toBe(20001);
    } finally {
      asAdmin();
    }
  });

  it('operator：订单接口 403，工单与任务可读、不可写', async () => {
    asAdmin();
    const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
    await confirmOrder(order.id).expect(200);
    const woList = await http
      .get(`/api/v1/work-orders?page=1&pageSize=10&saleOrderId=${order.id}`)
      .expect(200);
    const workOrderId = String(woList.body.data.list[0].id);
    const tasks = await http
      .get(`/api/v1/work-orders/${workOrderId}/tasks?page=1&pageSize=10`)
      .expect(200);
    const taskId = String(tasks.body.data.list[0].id);

    asOperator();
    try {
      expect((await http.get('/api/v1/orders').expect(403)).body.code).toBe(20004);
      expect((await http.get(`/api/v1/orders/${order.id}`).expect(403)).body.code).toBe(20004);
      expect((await http.post('/api/v1/orders').send({ code: nextOrderCode() }).expect(403)).body.code).toBe(20004);

      // 三角色可读工单与任务
      expect((await http.get('/api/v1/work-orders').expect(200)).body.code).toBe(0);
      expect((await http.get(`/api/v1/work-orders/${workOrderId}`).expect(200)).body.code).toBe(0);
      expect((await http.get(`/api/v1/work-orders/${workOrderId}/tasks`).expect(200)).body.code).toBe(0);
      expect((await http.get(`/api/v1/tasks/${taskId}`).expect(200)).body.code).toBe(0);

      // 计划修改与状态流转仅 admin / manager
      expect(
        (await http.patch(`/api/v1/work-orders/${workOrderId}`).send({ planEnd: shanghaiDate(6) }).expect(403))
          .body.code,
      ).toBe(20004);
      expect(
        (
          await http
            .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
            .send({ expectedStatus: '待启动', targetStatus: '在产' })
            .expect(403)
        ).body.code,
      ).toBe(20004);
      expect(
        (
          await http
            .post(`/api/v1/tasks/${taskId}/state-transitions`)
            .send({ expectedStatus: '待启动', targetStatus: '在产' })
            .expect(403)
        ).body.code,
      ).toBe(20004);
      expect(
        (await http.patch(`/api/v1/tasks/${taskId}`).send({ prodLine: 'SMT-1' }).expect(403)).body.code,
      ).toBe(20004);
    } finally {
      asAdmin();
    }
  });

  it('manager 可读写订单与工单（计划 / 状态流转）', async () => {
    asManager();
    try {
      const order = await createOrder('JC-PLC-2001', 10, shanghaiDate(5));
      const confirmed = await confirmOrder(order.id).expect(200);
      const workOrderId = String(confirmed.body.data.workOrders[0].id);

      const planned = await http
        .patch(`/api/v1/work-orders/${workOrderId}`)
        .send({ planStart: shanghaiDate(1), planEnd: shanghaiDate(4) })
        .expect(200);
      expect(planned.body.data.planStart).toBe(shanghaiDate(1));

      const transitioned = await http
        .post(`/api/v1/work-orders/${workOrderId}/state-transitions`)
        .send({ expectedStatus: '待启动', targetStatus: '在产' })
        .expect(200);
      expect(transitioned.body.data.status).toBe('在产');
    } finally {
      asAdmin();
    }
  });
});

// ================================================================ E. 回归与通用契约

describe('E. 回归与通用契约', () => {
  it('S2 健康检查不回归', async () => {
    const response = await http.get('/api/v1/health').expect(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.database.status).toBe('up');
  });

  it('每个响应都带 X-Request-Id，且错误包体符合契约', async () => {
    asAdmin();
    const ok = await http.get('/api/v1/orders?page=1&pageSize=1').expect(200);
    expect(ok.headers['x-request-id']).toBeTruthy();

    const bad = await http.get('/api/v1/orders?page=abc').expect(400);
    expect(bad.body).toMatchObject({ code: 10001, message: '参数错误' });
    expect(Array.isArray(bad.body.data.errors)).toBe(true);
  });

  it('产品最小只读接口可用，且标注为企业主数据（不是演示数据）', async () => {
    asAdmin();
    const response = await http.get('/api/v1/products?page=1&pageSize=100').expect(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.total).toBeGreaterThan(0);
    const jc = (response.body.data.list as Array<Record<string, unknown>>).find(
      (item) => item.code === 'JC-PLC-2001',
    );
    expect(jc).toBeDefined();
    expect(jc!.dataSource).toBe('enterprise-master');
    expect(jc!.dataLabel).toBeUndefined();
  });

  it('未启用路由不注册（不存在删除订单 / 随意创建工单等接口）', async () => {
    asAdmin();
    expect((await http.delete('/api/v1/orders/1').expect(404)).body.code).toBe(30001);
    expect((await http.post('/api/v1/work-orders').send({}).expect(404)).body.code).toBe(30001);
    expect((await http.post('/api/v1/tasks').send({}).expect(404)).body.code).toBe(30001);
  });
});
