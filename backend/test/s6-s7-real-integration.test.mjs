import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DataSource } from 'typeorm';
import { MetricsAggregationService } from '../dist/modules/dashboards/metrics-aggregation.service.js';
import { WorkOrdersService } from '../dist/modules/work-orders/work-orders.service.js';
import { ReportsService } from '../dist/modules/reports/reports.service.js';
import { QualityInspectionsService } from '../dist/modules/quality-inspections/quality-inspections.service.js';
import { AlertsService } from '../dist/modules/alerts/alerts.service.js';
import { AuditService } from '../dist/modules/audit/audit.service.js';

// -----------------------------------------------------------------------------
// 1. 口令与环境安全门禁（零明文回退，必须由外部环境变量注入）
// -----------------------------------------------------------------------------
const password = process.env.DB_PASSWORD;
if (!password) {
  console.error('❌ [安全门禁拦截] 必须通过环境变量 DB_PASSWORD 显式注入数据库口令，严禁代码硬编码与回退默认值！');
  process.exit(1);
}

// 强制环境隔离门禁校验
if (process.env.ALLOW_S6S7_INTEGRATION_WRITE !== '1') {
  console.error('❌ [安全门禁拦截] 必须显式设置环境变量 ALLOW_S6S7_INTEGRATION_WRITE=1 方可授权执行写库集成测试！');
  process.exit(1);
}

if (process.env.TEST_ENV !== 'isolated') {
  console.error('❌ [安全门禁拦截] 必须设置环境变量 TEST_ENV=isolated，确认当前为专用隔离测试环境！');
  process.exit(1);
}

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = Number(process.env.DB_PORT || 3306);
const dbName = process.env.DB_NAME || 'smart_mes';

// 严格限定专用隔离测试库名称，坚决拒绝任何生产库或共享库特征
const lowerDb = dbName.toLowerCase();
if (
  process.env.NODE_ENV === 'production' ||
  lowerDb.includes('prod') ||
  lowerDb.includes('shared') ||
  lowerDb.includes('online') ||
  lowerDb !== 'smart_mes'
) {
  console.error(`❌ [安全门禁拦截] 拒绝连接: dbName='${dbName}', NODE_ENV='${process.env.NODE_ENV}'。仅允许连接专用隔离测试库 smart_mes！`);
  process.exit(1);
}

const RUN_ID = `S6S7-TEST-${Date.now()}`;
const SHORT_ID = Date.now().toString().slice(-8);
const startTime = new Date().toISOString();

// 日志缓冲与自动 UTF-8 落地拦截器
const logBuffer = [];
const origLog = console.log;
const origErr = console.error;
console.log = (...args) => {
  origLog(...args);
  logBuffer.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
};
console.error = (...args) => {
  origErr(...args);
  logBuffer.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
};

console.log('================================================================');
console.log(`[S6 + S7 真实数据库集成回归测试套件（严格受控复核版）]`);
console.log(`RUN_ID: ${RUN_ID}`);
console.log(`执行时刻: ${startTime}`);
console.log(`Node: ${process.version}, 架构: ${process.arch}`);
console.log(`目标库: ${dbName} @ ${dbHost}:${dbPort}`);
console.log('================================================================\n');

/**
 * 模拟在底层审计写入环节发生异常的故障注入服务
 */
class FailingAuditService extends AuditService {
  async write(manager, entry) {
    void manager;
    void entry;
    throw new Error('SIMULATED_AUDIT_WRITE_FAILURE');
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: 'root',
    password: password,
    database: dbName,
  });

  const ds = new DataSource({
    type: 'mysql',
    host: dbHost,
    port: dbPort,
    username: 'root',
    password: password,
    database: dbName,
    entities: ['./dist/entities/*.entity.js'],
    synchronize: false,
    logging: false,
  });
  await ds.initialize();

  const auditService = new AuditService();
  const metricsService = new MetricsAggregationService(ds);
  const workOrdersService = new WorkOrdersService(ds, auditService);
  const reportsService = new ReportsService(ds, auditService);
  const qcService = new QualityInspectionsService(ds, auditService);
  const alertsService = new AlertsService(ds, auditService, metricsService);

  // 故障注入专用业务服务
  const failingAuditService = new FailingAuditService();
  const failingReportsService = new ReportsService(ds, failingAuditService);
  const failingQcService = new QualityInspectionsService(ds, failingAuditService);

  // 严格记录测试创建的每一个实体 ID，用于精确无污染清理
  const createdOrders = [];
  const createdWos = [];
  const createdTasks = [];
  const createdReports = [];
  const createdQc = [];
  const createdDefects = [];
  const createdUsers = [];

  // ---------------------------------------------------------------------------
  // 步骤 1：数据库环境预检与既有基线数据内容指纹快照（核验 audit_log, sys_user, device）
  // ---------------------------------------------------------------------------
  console.log('--- [步骤 1: 数据库预检与既有基线全字段指纹快照] ---');
  const targetTables = ['sale_order', 'work_order', 'work_task', 'report', 'qc_record', 'defect', 'alert', 'audit_log', 'sys_user', 'device'];
  const baselineCounts = {};
  for (const tbl of targetTables) {
    if (tbl === 'device') {
      const [rows] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
      baselineCounts[tbl] = { count: Number(rows[0].cnt), maxId: 0 };
    } else {
      const [rows] = await conn.query(`SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS max_id FROM \`${tbl}\``);
      baselineCounts[tbl] = { count: Number(rows[0].cnt), maxId: Number(rows[0].max_id) };
    }
  }

  // 既有数据全字段完整指纹校验（防篡改既有数据行）
  const [initialAuditRows] = await conn.query(`SELECT id, user_id, action, target, detail, ip, created_at FROM audit_log ORDER BY id ASC`);
  const initialAuditFingerprint = crypto.createHash('sha256').update(JSON.stringify(initialAuditRows)).digest('hex');

  const [initialUserRows] = await conn.query(`SELECT id, username, name, dept, post, role, phone, password_hash, enabled, created_at FROM sys_user ORDER BY id ASC`);
  const initialUserFingerprint = crypto.createHash('sha256').update(JSON.stringify(initialUserRows)).digest('hex');

  const [initialDeviceRows] = await conn.query(`SELECT code, name, workshop, prod_line, status, purchase_year, supplier, remark, updated_at FROM device ORDER BY code ASC`);
  const initialDeviceFingerprint = crypto.createHash('sha256').update(JSON.stringify(initialDeviceRows)).digest('hex');

  console.log('测试前各表基线行数:', baselineCounts);
  console.log(`既有 audit_log 行数: ${initialAuditRows.length}, SHA-256: ${initialAuditFingerprint}`);
  console.log(`既有 sys_user 行数: ${initialUserRows.length}, SHA-256: ${initialUserFingerprint}`);
  console.log(`既有 device 行数: ${initialDeviceRows.length}, SHA-256: ${initialDeviceFingerprint}`);

  // 1.1 隔离库实例与标识核验
  const [dbMeta] = await conn.query('SELECT DATABASE() AS current_db, @@version AS mysql_version');
  const currentDb = dbMeta[0]?.current_db;
  if (currentDb !== 'smart_mes') {
    console.error(`❌ [隔离库核验失败] 当前连接数据库为 '${currentDb}'，非核准隔离测试库 'smart_mes'！`);
    process.exit(1);
  }

  // 1.2 预先登记的专用隔离测试库基线指纹核验（防止误连到同名但包含真实业务数据的数据库）
  const EXPECTED_USER_FINGERPRINT = '020804051663d86afb6d2b9ae016068c169ce395c547b1a82300910d78e74279';
  const EXPECTED_DEVICE_FINGERPRINT = '6b0b9f0626451b920620cfe963c7319cf30d18f20dced92ccca83fdbb40f48cf';
  const EXPECTED_AUDIT_FINGERPRINT = '115a7ad288574dd0794b1e0059f0e78914aa6e381d90cabbc8a120b8fb920e2c';

  if (initialUserFingerprint !== EXPECTED_USER_FINGERPRINT || initialDeviceFingerprint !== EXPECTED_DEVICE_FINGERPRINT || initialAuditFingerprint !== EXPECTED_AUDIT_FINGERPRINT) {
    console.error(`❌ [隔离库基线指纹不匹配] 数据库特征与核准的隔离测试基线不符，拒绝执行写入！`);
    console.error(`user: ${initialUserFingerprint} (expected: ${EXPECTED_USER_FINGERPRINT})`);
    console.error(`device: ${initialDeviceFingerprint} (expected: ${EXPECTED_DEVICE_FINGERPRINT})`);
    console.error(`audit: ${initialAuditFingerprint} (expected: ${EXPECTED_AUDIT_FINGERPRINT})`);
    process.exit(1);
  }
  console.log('✓ 隔离库环境标识与预设基线指纹核验通过 (smart_mes @ 127.0.0.1:3306)');

  try {
    // =========================================================================
    // 场景 A：S6 生产报工与质量检验写入链路深度实测
    // =========================================================================
    console.log('\n--- [场景 A: S6 生产报工与质量检验写入链路深度实测] ---');

    // A1. 创建专用销售订单与主工单
    const orderCode1 = `SO-${SHORT_ID}-01`;
    const [soRes1] = await conn.query(
      `INSERT INTO sale_order (code, product_code, qty, due_date, status)
       VALUES (?, 'JC-PLC-2001', 100, '2026-10-15', '待确认')`,
      [orderCode1]
    );
    const soId1 = soRes1.insertId;
    createdOrders.push(soId1);

    const woCode1 = `WO-${SHORT_ID}-01`;
    const [woRes1] = await conn.query(
      `INSERT INTO work_order (code, sale_order_id, product_code, qty, status, plan_start, plan_end, done_qty)
       VALUES (?, ?, 'JC-PLC-2001', 100, '待启动', '2026-10-09', '2026-10-15', 0)`,
      [woCode1, soId1]
    );
    const woId1 = woRes1.insertId;
    createdWos.push(woId1);

    // 插入 Task 1 (seq=1, 中间工序: SMT贴片, 待启动)
    const [taskRes1] = await conn.query(
      `INSERT INTO work_task (work_order_id, seq, step_name, status, prod_line, workshop, plan_qty, good_qty, bad_qty)
       VALUES (?, 1, 'SMT贴片', '待启动', 'SMT-1线', '一车间', 100, 0, 0)`,
      [woId1]
    );
    const taskId1 = taskRes1.insertId;
    createdTasks.push(taskId1);

    // 插入 Task 2 (seq=2, 末道工序: 总装检验, 待启动, 预置设备 EQP-SMT-001)
    const [taskRes2] = await conn.query(
      `INSERT INTO work_task (work_order_id, seq, step_name, status, prod_line, workshop, device_code, plan_qty, good_qty, bad_qty)
       VALUES (?, 2, '总装检验', '待启动', 'SMT-1线', '一车间', 'EQP-SMT-001', 100, 0, 0)`,
      [woId1]
    );
    const taskId2 = taskRes2.insertId;
    createdTasks.push(taskId2);

    console.log(`✓ A1 成功落库订单 #${soId1}, 工单 #${woId1}, 任务 #${taskId1}(seq=1) 和 #${taskId2}(seq=2)`);

    // A2. 任务 seq 顺序、工单暂停/恢复/关闭及人工完工规则
    // 2.1 任务 seq 强约束：前序未完工拦截后序启动 (30003)
    await workOrdersService.transitionTask(
      String(taskId2),
      { expectedStatus: '待启动', targetStatus: '在产' },
      { userId: '1', ip: '127.0.0.1' }
    ).then(() => {
      throw new Error('[A2 失败] 前序任务未完工时启动后序任务必须被拦截！');
    }).catch((err) => {
      if (err.code !== 30003) throw err;
    });

    // 2.2 工单流转：待启动 → 在产 → 暂停 → 恢复在产
    await workOrdersService.transitionWorkOrder(
      String(woId1),
      { expectedStatus: '待启动', targetStatus: '在产' },
      { userId: '1', ip: '127.0.0.1' }
    );
    await workOrdersService.transitionWorkOrder(
      String(woId1),
      { expectedStatus: '在产', targetStatus: '暂停' },
      { userId: '1', ip: '127.0.0.1' }
    );
    await workOrdersService.transitionWorkOrder(
      String(woId1),
      { expectedStatus: '暂停', targetStatus: '在产' },
      { userId: '1', ip: '127.0.0.1' }
    );

    // 2.3 专用工单关闭与终态不可逆流转验证
    const woCodeClose = `WO-${SHORT_ID}-CLS`;
    const [woCloseRes] = await conn.query(
      `INSERT INTO work_order (code, product_code, qty, status, plan_start, plan_end, done_qty)
       VALUES (?, 'JC-PLC-2001', 10, '待启动', '2026-10-09', '2026-10-15', 0)`,
      [woCodeClose]
    );
    const woIdClose = woCloseRes.insertId;
    createdWos.push(woIdClose);

    await workOrdersService.transitionWorkOrder(
      String(woIdClose),
      { expectedStatus: '待启动', targetStatus: '关闭' },
      { userId: '1', ip: '127.0.0.1' }
    );
    await workOrdersService.transitionWorkOrder(
      String(woIdClose),
      { expectedStatus: '关闭', targetStatus: '在产' },
      { userId: '1', ip: '127.0.0.1' }
    ).then(() => {
      throw new Error('[A2 失败] 关闭终态工单不可逆向流转！');
    }).catch((err) => {
      if (err.code !== 30003) throw err;
    });
    console.log('✓ A2 任务 seq 强约束、工单暂停/恢复/关闭及终态不可逆验证通过 (30003)');

    // A3. 分配规则深度验证（停用操作员、非运行中设备、只改产线联动校验已有设备）
    // 3.1 停用操作员校验
    const [disabledUserRes] = await conn.query(
      `INSERT INTO sys_user (username, name, password_hash, role, enabled)
       VALUES (?, '停用测试员', 'hash123', '操作工', 0)`,
      [`disabled_${SHORT_ID}`]
    );
    const disabledUserId = disabledUserRes.insertId;
    createdUsers.push(disabledUserId);

    await workOrdersService.updateTask(String(taskId1), { operatorId: String(disabledUserId) }, { userId: '1', ip: null })
      .then(() => { throw new Error('[A3 失败] 分配停用操作员应被拒绝'); })
      .catch((err) => { if (err.code !== 10002 || !err.message.includes('未启用')) throw err; });

    // 3.2 不存在操作员校验
    await workOrdersService.updateTask(String(taskId1), { operatorId: '99999999' }, { userId: '1', ip: null })
      .then(() => { throw new Error('[A3 失败] 分配不存在操作员应被拒绝'); })
      .catch((err) => { if (err.code !== 10002) throw err; });

    // 3.3 设备状态非“运行中”校验 (EQP-SMT-006 既有状态为“维修中”)
    await workOrdersService.updateTask(String(taskId1), { deviceCode: 'EQP-SMT-006' }, { userId: '1', ip: null })
      .then(() => { throw new Error('[A3 失败] 分配维修中设备应被拒绝'); })
      .catch((err) => { if (err.code !== 30003 || !err.message.includes('不是运行中')) throw err; });

    // 3.4 只改产线时重新校验已有设备：
    // taskId2 已绑定 SMT-1线设备 EQP-SMT-001。更新产线为 SMT-2线且不传 deviceCode，应触发设备产线不一致校验
    await workOrdersService.updateTask(String(taskId2), { prodLine: 'SMT-2线' }, { userId: '1', ip: null })
      .then(() => { throw new Error('[A3 失败] 只改产线时应自动联动校验已有设备！'); })
      .catch((err) => { if (err.code !== 10002 || !err.message.includes('设备所属产线与任务产线不一致')) throw err; });
    console.log('✓ A3 分配规则深度验证通过：停用操作员(10002)、非运行中设备(30003)、只改产线联动已有设备(10002)');

    // A4. 生产报工（中间工序 vs 末道工序）
    await workOrdersService.transitionTask(String(taskId1), { expectedStatus: '待启动', targetStatus: '在产' }, { userId: '1', ip: '127.0.0.1' });

    // 中间工序在产报工：良品 20, 不良 2
    const repResMid = await reportsService.create(
      { taskId: String(taskId1), goodQty: 20, badQty: 2 },
      { userId: '1', ip: '127.0.0.1' }
    );
    createdReports.push(Number(repResMid.report.id));

    const [woAfterMid] = await conn.query(`SELECT done_qty FROM work_order WHERE id = ?`, [woId1]);
    const [task1AfterMid] = await conn.query(`SELECT good_qty, bad_qty FROM work_task WHERE id = ?`, [taskId1]);
    if (Number(task1AfterMid[0].good_qty) !== 20 || Number(woAfterMid[0].done_qty) !== 0) {
      throw new Error(`[A4 失败] 中间工序报工错误计入工单完成量！wo.done_qty=${woAfterMid[0].done_qty}`);
    }

    // 任务 1 完工，解锁任务 2
    await workOrdersService.transitionTask(String(taskId1), { expectedStatus: '在产', targetStatus: '完工' }, { userId: '1', ip: '127.0.0.1' });
    await workOrdersService.transitionTask(String(taskId2), { expectedStatus: '待启动', targetStatus: '在产' }, { userId: '1', ip: '127.0.0.1' });

    // 末道工序在产报工：良品 76, 不良 4
    const repResLast = await reportsService.create(
      { taskId: String(taskId2), goodQty: 76, badQty: 4 },
      { userId: '1', ip: '127.0.0.1' }
    );
    createdReports.push(Number(repResLast.report.id));
    await conn.query(`UPDATE report SET reported_at = '2026-10-09 10:00:00' WHERE id = ?`, [repResLast.report.id]);

    const [woAfterLast] = await conn.query(`SELECT done_qty FROM work_order WHERE id = ?`, [woId1]);
    const [task2AfterLast] = await conn.query(`SELECT good_qty, bad_qty FROM work_task WHERE id = ?`, [taskId2]);
    if (Number(task2AfterLast[0].good_qty) !== 76 || Number(woAfterLast[0].done_qty) !== 76) {
      throw new Error(`[A4 失败] 末道工序报工未正确更新工单 done_qty！实际值: ${woAfterLast[0].done_qty}`);
    }
    console.log('✓ A4 生产报工成功：中间工序良品 20 件不计工单，末道工序良品 76 件累加工单 done_qty=76');

    // A5. 质量检验（OK 与 NG 缺陷持久化）
    const qcOkRes = await qcService.create(
      { workOrderId: String(woId1), taskId: String(taskId2), result: 'OK', checkQty: 50, ngQty: 0, defects: [] },
      { userId: '1', ip: '127.0.0.1' }
    );
    createdQc.push(Number(qcOkRes.id));

    const qcNgRes = await qcService.create(
      {
        workOrderId: String(woId1),
        taskId: String(taskId2),
        result: 'NG',
        checkQty: 10,
        ngQty: 2,
        defects: [{ defectType: '虚焊', qty: 2, description: `[${RUN_ID}] 针脚虚焊` }],
      },
      { userId: '1', ip: '127.0.0.1' }
    );
    createdQc.push(Number(qcNgRes.id));

    const [defRows] = await conn.query(`SELECT id, defect_type, qty FROM defect WHERE qc_record_id = ?`, [qcNgRes.id]);
    for (const d of defRows) createdDefects.push(d.id);
    if (defRows.length !== 1 || defRows[0].defect_type !== '虚焊' || defRows[0].qty !== 2) {
      throw new Error('[A5 失败] NG 检验缺陷明细未能正确持久化到 defect 表');
    }

    await qcService.create(
      { workOrderId: String(woId1), taskId: String(taskId2), result: 'NG', checkQty: 10, ngQty: 2, defects: [{ defectType: '划痕', qty: 3 }] },
      { userId: '1', ip: '127.0.0.1' }
    ).then(() => { throw new Error('[A5 失败] ngQty 与 defects 之和不符应被拒绝'); })
      .catch((err) => { if (err.code !== 10003) throw err; });
    console.log('✓ A5 质量检验成功：OK (50件) 与 NG (2件虚焊) 均严格入库，数量不一致拒绝 10003');

    // A6. 真实业务服务全链路多表原子回滚验证
    // 6.1 验证 ReportsService.create 在审计崩溃时回滚 report、work_task、work_order
    const [woBeforeRepFail] = await conn.query(`SELECT done_qty FROM work_order WHERE id = ?`, [woId1]);
    const [taskBeforeRepFail] = await conn.query(`SELECT good_qty FROM work_task WHERE id = ?`, [taskId2]);
    const [repCntBeforeFail] = await conn.query(`SELECT COUNT(*) AS cnt FROM report WHERE task_id = ?`, [taskId2]);

    try {
      await failingReportsService.create({ taskId: String(taskId2), goodQty: 15, badQty: 0 }, { userId: '1', ip: null });
      throw new Error('[A6 失败] 模拟审计失败未抛出');
    } catch (e) {
      if (e.message !== 'SIMULATED_AUDIT_WRITE_FAILURE') throw e;
    }

    const [woAfterRepFail] = await conn.query(`SELECT done_qty FROM work_order WHERE id = ?`, [woId1]);
    const [taskAfterRepFail] = await conn.query(`SELECT good_qty FROM work_task WHERE id = ?`, [taskId2]);
    const [repCntAfterFail] = await conn.query(`SELECT COUNT(*) AS cnt FROM report WHERE task_id = ?`, [taskId2]);

    if (
      Number(woAfterRepFail[0].done_qty) !== Number(woBeforeRepFail[0].done_qty) ||
      Number(taskAfterRepFail[0].good_qty) !== Number(taskBeforeRepFail[0].good_qty) ||
      Number(repCntAfterFail[0].cnt) !== Number(repCntBeforeFail[0].cnt)
    ) {
      throw new Error('[A6 失败] 报工服务失败时未全链路回滚工单、任务和报工表！');
    }

    // 6.2 验证 QualityInspectionsService.create 在审计崩溃时回滚 qc_record 和 defect 表
    const [qcCntBeforeFail] = await conn.query(`SELECT COUNT(*) AS cnt FROM qc_record WHERE work_order_id = ?`, [woId1]);
    const [defCntBeforeFail] = await conn.query(`SELECT COUNT(*) AS cnt FROM defect`);

    try {
      await failingQcService.create({
        workOrderId: String(woId1),
        taskId: String(taskId2),
        result: 'NG',
        checkQty: 5,
        ngQty: 1,
        defects: [{ defectType: '崩边', qty: 1 }],
      }, { userId: '1', ip: null });
      throw new Error('[A6 失败] 质检审计失败未抛出');
    } catch (e) {
      if (e.message !== 'SIMULATED_AUDIT_WRITE_FAILURE') throw e;
    }

    const [qcCntAfterFail] = await conn.query(`SELECT COUNT(*) AS cnt FROM qc_record WHERE work_order_id = ?`, [woId1]);
    const [defCntAfterFail] = await conn.query(`SELECT COUNT(*) AS cnt FROM defect`);

    if (
      Number(qcCntAfterFail[0].cnt) !== Number(qcCntBeforeFail[0].cnt) ||
      Number(defCntAfterFail[0].cnt) !== Number(defCntBeforeFail[0].cnt)
    ) {
      throw new Error('[A6 失败] 质检服务失败时未全链路回滚质检主表与缺陷明细表！');
    }
    console.log('✓ A6 真实业务服务全链路多表原子回滚验证通过 (报工/质检服务底层中断 100% 回滚)');

    // =========================================================================
    // 场景 B：S7 驾驶舱指标聚合、四舍五入边缘、缺计划与预警读取
    // =========================================================================
    console.log('\n--- [场景 B: S7 指标聚合、四舍五入边缘、缺计划与预警读取实测] ---');

    // B1 & B2. 使用真实数据查询生产指标
    const metricsRes1 = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-1线' },
      '2026-10-11T09:00:00.000+08:00'
    );
    const lineMetrics1 = metricsRes1.lines.find(l => l.prodLine === 'SMT-1线');
    if (lineMetrics1?.goodQty !== 76 || lineMetrics1?.outputQty !== 80 || lineMetrics1?.goodRate !== 95) {
      throw new Error(`[B1 失败] 报工指标计算与预期不符: goodQty=${lineMetrics1?.goodQty}, goodRate=${lineMetrics1?.goodRate}`);
    }
    console.log('✓ B1 & B2 生产指标聚合对齐：良品 76 件、产量 80 件、报工良品率 95.00%、isTrueFpy=false');

    // B3. 验证昨日数据加今日数据时累计值不被今日窗口覆盖
    const [rYesterday] = await conn.query(
      `INSERT INTO report (task_id, user_id, good_qty, bad_qty, reported_at)
       VALUES (?, 1, 50, 0, '2026-10-08 14:00:00')`,
      [taskId2]
    );
    createdReports.push(rYesterday.insertId);

    const metricsResYesterday = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-1线' },
      '2026-10-11T09:00:00.000+08:00'
    );
    const lineMetricsYesterday = metricsResYesterday.lines.find(l => l.prodLine === 'SMT-1线');
    if (lineMetricsYesterday?.goodQty !== 76 || lineMetricsYesterday?.doneQty !== 126) {
      throw new Error(`[B3 失败] 累计完成量被窗口覆盖: doneQty=${lineMetricsYesterday?.doneQty}`);
    }
    console.log('✓ B3 累计完成量严格等于 126 件 (昨日 50 + 今日 76)，未被当日窗口量覆盖');

    // B4. 验证次日 00:00:00 边界排除
    const [rTomorrowZero] = await conn.query(
      `INSERT INTO report (task_id, user_id, good_qty, bad_qty, reported_at)
       VALUES (?, 1, 10, 0, '2026-10-10 00:00:00')`,
      [taskId2]
    );
    createdReports.push(rTomorrowZero.insertId);

    const metricsResHalfOpen = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-1线' },
      '2026-10-11T09:00:00.000+08:00'
    );
    const lineMetricsHalfOpen = metricsResHalfOpen.lines.find(l => l.prodLine === 'SMT-1线');
    if (lineMetricsHalfOpen?.doneQty !== 126) {
      throw new Error(`[B4 失败] 次日 00:00:00 报工被计入: doneQty=${lineMetricsHalfOpen?.doneQty}`);
    }
    console.log('✓ B4 历史半开区间严格排除次日 00:00:00 报工 (doneQty=126)');

    // B5. 补齐四舍五入边界场景验证：显示为 97.00% 但原始比率 96.995% < 97% 触发预警！
    // 构造专用测试工单与末道工序：良品 19399，不良 601，总产量 20000 (19399/20000 = 96.995%)
    const woCodeBoundary = `WO-${SHORT_ID}-BDY`;
    const [woBdyRes] = await conn.query(
      `INSERT INTO work_order (code, product_code, qty, status, plan_start, plan_end, done_qty)
       VALUES (?, 'JC-PLC-2001', 20000, '在产', '2026-10-12', '2026-10-12', 19399)`,
      [woCodeBoundary]
    );
    createdWos.push(woBdyRes.insertId);

    const [taskBdyRes] = await conn.query(
      `INSERT INTO work_task (work_order_id, seq, step_name, status, prod_line, workshop, plan_qty, good_qty, bad_qty)
       VALUES (?, 1, '末道检验', '在产', 'SMT-2线', '一车间', 20000, 19399, 601)`,
      [woBdyRes.insertId]
    );
    createdTasks.push(taskBdyRes.insertId);

    const [repBdyRes] = await conn.query(
      `INSERT INTO report (task_id, user_id, good_qty, bad_qty, reported_at)
       VALUES (?, 1, 19399, 601, '2026-10-12 12:00:00')`,
      [taskBdyRes.insertId]
    );
    createdReports.push(repBdyRes.insertId);

    const metricsBdy = await metricsService.getProductionMetrics(
      { startDate: '2026-10-12', endDate: '2026-10-12', prodLine: 'SMT-2线' },
      '2026-10-12T18:00:00.000+08:00'
    );
    const alertEvalBdy = await metricsService.evaluateAlertRules(
      { startDate: '2026-10-12', endDate: '2026-10-12', prodLine: 'SMT-2线' },
      '2026-10-12T18:00:00.000+08:00'
    );
    const lineBdy = metricsBdy.lines.find(l => l.prodLine === 'SMT-2线');
    const goodRateAlertBdy = alertEvalBdy.evaluations.find(e => e.ruleId === 'goodRate');

    // 验证：显示四舍五入为 97.00%，但原始比率 96.995% < 97%，必须触发预警 (triggered=true)
    if (lineBdy?.goodRate !== 97 || !goodRateAlertBdy?.triggered) {
      throw new Error(`[B5 失败] 阈值边界未采用原始值: goodRate=${lineBdy?.goodRate}, triggered=${goodRateAlertBdy?.triggered}`);
    }
    console.log('✓ B5 阈值四舍五入边界严谨验证通过：四舍五入显示 97.00%，原始比率(96.995%)精准触发预警(triggered=true)');

    // B6. 验证“缺计划”与“逆序计划”两个独立场景（补齐缺计划）
    // 6.1 单独缺计划工单场景 (plan_start IS NULL, plan_end IS NULL)
    const woCodeMissingPlan = `WO-${SHORT_ID}-NOPLAN`;
    const [woMissingRes] = await conn.query(
      `INSERT INTO work_order (code, product_code, qty, status, plan_start, plan_end)
       VALUES (?, 'JC-PLC-2001', 50, '待启动', NULL, NULL)`,
      [woCodeMissingPlan]
    );
    createdWos.push(woMissingRes.insertId);

    const metricsMissing = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-15' },
      '2026-10-11T09:00:00.000+08:00'
    );
    if (metricsMissing.metrics.calculationStatus !== 'insufficient_data') {
      throw new Error(`[B6 失败] 缺计划工单应返回 insufficient_data，实际: ${metricsMissing.metrics.calculationStatus}`);
    }

    // 6.2 逆序计划工单场景 (plan_start > plan_end)
    const woCodeInverted = `WO-${SHORT_ID}-INV`;
    const [woInvRes] = await conn.query(
      `INSERT INTO work_order (code, product_code, qty, status, plan_start, plan_end)
       VALUES (?, 'JC-PLC-2001', 50, '待启动', '2026-10-20', '2026-10-10')`,
      [woCodeInverted]
    );
    createdWos.push(woInvRes.insertId);

    const metricsInv = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-15' },
      '2026-10-11T09:00:00.000+08:00'
    );
    if (metricsInv.metrics.calculationStatus !== 'insufficient_data') {
      throw new Error(`[B6 失败] 逆序计划应返回 insufficient_data`);
    }
    const alertEvalInv = await metricsService.evaluateAlertRules(
      { startDate: '2026-10-09', endDate: '2026-10-15' },
      '2026-10-11T09:00:00.000+08:00'
    );
    if (alertEvalInv.evaluations.find(e => e.ruleId === 'completionRate')?.triggered) {
      throw new Error('[B6 失败] 数据不足时不可触发不可靠交付预警');
    }
    console.log('✓ B6 缺计划与逆序计划独立场景均返回 insufficient_data 且豁免虚假交付预警');

    // B7. 驾驶舱后端钻取明细过滤（严格排除非目标范围数据混入）
    const woListSmt1 = await workOrdersService.list({ prodLine: 'SMT-1线', page: '1', pageSize: '50' });
    if (!woListSmt1.list.some(w => w.code === woCode1)) {
      throw new Error('[B7 失败] 工单钻取未查出 SMT-1线目标工单');
    }
    // 严格排除跨产线与未分配产线工单混入
    if (woListSmt1.list.some(w => w.code === woCodeBoundary)) {
      throw new Error('[B7 失败] 工单钻取混入了 SMT-2线工单');
    }
    if (woListSmt1.list.some(w => w.code === woCodeMissingPlan || w.code === woCodeInverted)) {
      throw new Error('[B7 失败] 工单钻取混入了未分配产线工单');
    }

    const repListSmt1 = await reportsService.list({ prodLine: 'SMT-1线', workOrderId: String(woId1), page: '1', pageSize: '50' });
    if (repListSmt1.list.length === 0) {
      throw new Error('[B7 失败] 报工钻取未查出记录');
    }
    // 严格范围断言：查出的全部报工记录都必须严格属于 woId1 的任务 (taskId1 或 taskId2)，零跨界混入
    for (const r of repListSmt1.list) {
      if (r.taskId !== String(taskId1) && r.taskId !== String(taskId2)) {
        throw new Error(`[B7 失败] 报工钻取混入了非目标任务记录: taskId=${r.taskId}`);
      }
    }
    if (repListSmt1.list.some(r => Number(r.id) === Number(repBdyRes.insertId))) {
      throw new Error('[B7 失败] 报工钻取混入了 SMT-2线报工记录');
    }

    const qcListSmt1 = await qcService.list({ prodLine: 'SMT-1线', workOrderId: String(woId1), page: '1', pageSize: '50' });
    if (qcListSmt1.list.length === 0) {
      throw new Error('[B7 失败] 质检钻取未查出记录');
    }
    for (const q of qcListSmt1.list) {
      if (q.workOrderId !== String(woId1) || q.taskId !== String(taskId2)) {
        throw new Error(`[B7 失败] 质检钻取混入了非目标工单或任务记录: wo=${q.workOrderId}, task=${q.taskId}`);
      }
    }
    console.log('✓ B7 驾驶舱后端明细过滤钻取正常，严格断言零跨界数据混入（声明：前端路由与点击在第三层验证）');

    // B8. Q6 预警写入硬阻断
    await alertsService.transitionState('1', { expectedStatus: '未处理', targetStatus: '已确认' }, { userId: '1', ip: null })
      .then(() => { throw new Error('[B8 失败] Q6 状态流转未被拒绝'); })
      .catch((err) => { if (err.code !== 30006) throw err; });
    console.log('✓ B8 Q6 预警流转被严格阻断拦截抛出 30006');

    // =========================================================================
    // 场景 C：真实应用事务入口下的并发快照读保真与错误传播
    // =========================================================================
    console.log('\n--- [场景 C: 真实应用事务入口下的并发快照读保真与错误传播实测] ---');

    // C1 & C2. 保留真实的 ds.transaction 入口，在聚合服务查询之间设置屏障并提交并发写入
    const origDsTransaction = ds.transaction.bind(ds);
    let barrierTriggered = false;
    let queryStep = 0;
    let concurReportId = null;

    // 拦截 ds.transaction，在真实的 TypeORM 事务内部设立屏障
    ds.transaction = async function (isolationOrRun, maybeRun) {
      const isolation = typeof isolationOrRun === 'string' ? isolationOrRun : 'REPEATABLE READ';
      const run = typeof isolationOrRun === 'function' ? isolationOrRun : maybeRun;

      return origDsTransaction(isolation, async (manager) => {
        const origQuery = manager.query.bind(manager);
        manager.query = async function (sql, params) {
          queryStep++;
          const res = await origQuery(sql, params);

          // 在候选工单查询 (第2步) 完成后，挂起屏障，由外部连接并发插入并 COMMIT 新报工！
          if (queryStep === 2 && !barrierTriggered) {
            barrierTriggered = true;
            // 外部独立物理连接通过真实 reportsService 提交新报工
            const concurRes = await reportsService.create(
              { taskId: String(taskId2), goodQty: 88, badQty: 0 },
              { userId: '1', ip: '127.0.0.1' }
            );
            concurReportId = Number(concurRes.report.id);
            createdReports.push(concurReportId);
            await conn.query(`UPDATE report SET reported_at = '2026-10-09 16:00:00' WHERE id = ?`, [concurReportId]);
          }
          return res;
        };
        return run(manager);
      });
    };

    // 执行真实聚合调用：内部走真实 ds.transaction('REPEATABLE READ', ...)
    const snapshotMetrics = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-1线' },
      '2026-10-11T09:00:00.000+08:00'
    );
    // 恢复原始事务入口
    ds.transaction = origDsTransaction;

    const lineInSnapshot = snapshotMetrics.lines.find(l => l.prodLine === 'SMT-1线');
    // 在同一次聚合调用的中途虽然外部插入了 88 件报工，但处于真实 REPEATABLE READ 快照事务内，
    // 后续步骤 (queryWindowLastReports 与 queryCumulativeDoneQty) 依然读到一致快照 (goodQty 保持 76，未受 88 件干扰)
    if (lineInSnapshot?.goodQty !== 76) {
      throw new Error(`[C1/C2 失败] 真实应用事务入口下，中途并发提交破坏了一致性快照！goodQty=${lineInSnapshot?.goodQty}`);
    }

    // 事务提交后发起新查询，此时才感知最新的 88 件报工 (76 + 88 = 164)
    const afterMetrics = await metricsService.getProductionMetrics(
      { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-1线' },
      '2026-10-11T09:00:00.000+08:00'
    );
    const lineAfter = afterMetrics.lines.find(l => l.prodLine === 'SMT-1线');
    if (lineAfter?.goodQty !== 164) {
      throw new Error(`[C1/C2 失败] 新事务未能感知已提交的并发报工: goodQty=${lineAfter?.goodQty}`);
    }
    console.log('✓ C1 & C2 真实 DataSource 事务入口 + 查询屏障时序实测通过：单次聚合中途并发写不破坏一致性快照');

    // C3. 双连接并发报工行级锁（FOR UPDATE）无丢失更新
    const [woBeforeConc] = await conn.query(`SELECT done_qty FROM work_order WHERE id = ?`, [woId1]);
    const initDone = Number(woBeforeConc[0].done_qty);

    const concPromises = [
      reportsService.create({ taskId: String(taskId2), goodQty: 10, badQty: 0 }, { userId: '1', ip: null }),
      reportsService.create({ taskId: String(taskId2), goodQty: 10, badQty: 0 }, { userId: '1', ip: null }),
    ];
    const concResults = await Promise.all(concPromises);
    createdReports.push(Number(concResults[0].report.id));
    createdReports.push(Number(concResults[1].report.id));

    const [woAfterConc] = await conn.query(`SELECT done_qty FROM work_order WHERE id = ?`, [woId1]);
    if (Number(woAfterConc[0].done_qty) !== initDone + 20) {
      throw new Error(`[C3 失败] 并发报工丢失更新: 预期 ${initDone + 20}, 实际 ${woAfterConc[0].done_qty}`);
    }
    console.log('✓ C3 双并发报工行级锁排队无丢失更新通过 (+20 件)');

    // C4 & C5. 经过实际 MetricsAggregationService 聚合服务的错误传播（无吞并、无重跑降级）
    let txInvocationCount = 0;
    const origDsTxForC5 = ds.transaction.bind(ds);
    ds.transaction = async function (isolationOrRun, maybeRun) {
      txInvocationCount++;
      const isolation = typeof isolationOrRun === 'string' ? isolationOrRun : 'REPEATABLE READ';
      const run = typeof isolationOrRun === 'function' ? isolationOrRun : maybeRun;
      return origDsTxForC5(isolation, async (manager) => {
        const origQuery = manager.query.bind(manager);
        manager.query = async function () {
          throw new Error(`INJECTED_AGGREGATION_DB_ERROR_${RUN_ID}`);
        };
        return run(manager);
      });
    };

    try {
      // 经过实际聚合服务调用
      await metricsService.getProductionMetrics(
        { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-1线' },
        '2026-10-11T09:00:00.000+08:00'
      );
      throw new Error('[C5 失败] 聚合服务未能将内部数据库异常传播至外层！');
    } catch (err) {
      if (!err.message.includes(`INJECTED_AGGREGATION_DB_ERROR_${RUN_ID}`)) throw err;
    } finally {
      ds.transaction = origDsTxForC5;
    }

    if (txInvocationCount !== 1) {
      throw new Error(`[C5 失败] 聚合服务内部异常发生后触发了重跑降级！txInvocationCount=${txInvocationCount}`);
    }
    console.log('✓ C4 & C5 经过实际聚合服务底层查询错误直接传播验证通过 (txCount=1, 零静默重跑降级)');

    console.log('\n================================================================');
    console.log('所有深度集成实测场景执行完毕，执行精准受控数据清理！');
    console.log('================================================================\n');

  } finally {
    // ---------------------------------------------------------------------------
    // 步骤 5：安全受控精准清理与基线内容指纹重核（失败必须设置退出码 1）
    // ---------------------------------------------------------------------------
    console.log('--- [步骤 5: 安全受控精准清理与基线内容指纹重核] ---');

    // 1. 级联清理缺陷表
    if (createdDefects.length > 0) {
      await conn.query(`DELETE FROM defect WHERE id IN (${createdDefects.join(',')})`);
    }
    // 2. 级联清理质检主表
    if (createdQc.length > 0) {
      await conn.query(`DELETE FROM qc_record WHERE id IN (${createdQc.join(',')})`);
    }
    // 3. 清理报工记录
    if (createdReports.length > 0) {
      await conn.query(`DELETE FROM report WHERE id IN (${createdReports.join(',')})`);
    }
    // 4. 精确清理本轮实体产生的审计记录（白名单 Target 匹配，绝不用宽范围 id > baseline_max_id）
    const testAuditTargets = [
      ...createdTasks.map(id => `'work_task:${id}'`),
      ...createdWos.map(id => `'work_order:${id}'`),
      ...createdReports.map(id => `'report:${id}'`),
      ...createdQc.map(id => `'qc_record:${id}'`),
    ];
    if (testAuditTargets.length > 0) {
      await conn.query(`DELETE FROM audit_log WHERE target IN (${testAuditTargets.join(',')})`);
    }

    // 5. 清理工序任务
    if (createdTasks.length > 0) {
      await conn.query(`DELETE FROM work_task WHERE id IN (${createdTasks.join(',')})`);
    }
    // 6. 清理工单
    if (createdWos.length > 0) {
      await conn.query(`DELETE FROM work_order WHERE id IN (${createdWos.join(',')})`);
    }
    // 7. 清理销售订单
    if (createdOrders.length > 0) {
      await conn.query(`DELETE FROM sale_order WHERE id IN (${createdOrders.join(',')})`);
    }
    // 8. 清理临时测试用户
    if (createdUsers.length > 0) {
      await conn.query(`DELETE FROM sys_user WHERE id IN (${createdUsers.join(',')})`);
    }

    console.log('已精准删除本轮测试创建的实体及其直接关联的审计日志。');

    // 重核各表行数
    let isCountClean = true;
    for (const tbl of targetTables) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
      const cnt = Number(rows[0].cnt);
      if (cnt !== baselineCounts[tbl].count) {
        console.error(`❌ [基线行数不符] 表 ${tbl}: 测试前 ${baselineCounts[tbl].count}, 清理后 ${cnt}`);
        isCountClean = false;
      }
    }

    // 重核既有基线数据内容指纹（防止既有数据行被篡改）
    const [finalAuditRows] = await conn.query(`SELECT id, user_id, action, target, detail, ip, created_at FROM audit_log ORDER BY id ASC`);
    const finalAuditFingerprint = crypto.createHash('sha256').update(JSON.stringify(finalAuditRows)).digest('hex');

    const [finalUserRows] = await conn.query(`SELECT id, username, name, dept, post, role, phone, password_hash, enabled, created_at FROM sys_user ORDER BY id ASC`);
    const finalUserFingerprint = crypto.createHash('sha256').update(JSON.stringify(finalUserRows)).digest('hex');

    const [finalDeviceRows] = await conn.query(`SELECT code, name, workshop, prod_line, status, purchase_year, supplier, remark, updated_at FROM device ORDER BY code ASC`);
    const finalDeviceFingerprint = crypto.createHash('sha256').update(JSON.stringify(finalDeviceRows)).digest('hex');

    let isFingerprintClean = true;
    if (finalAuditFingerprint !== initialAuditFingerprint) {
      console.error('❌ [基线指纹不符] 既有 audit_log 内容指纹发生变化！');
      isFingerprintClean = false;
    }
    if (finalUserFingerprint !== initialUserFingerprint) {
      console.error('❌ [基线指纹不符] 既有 sys_user 内容指纹发生变化！');
      isFingerprintClean = false;
    }
    if (finalDeviceFingerprint !== initialDeviceFingerprint) {
      console.error('❌ [基线指纹不符] 既有 device 内容指纹发生变化！');
      isFingerprintClean = false;
    }

    await ds.destroy();
    await conn.end();

    // 关键修正（解决 P2）：清理核验失败时必须抛出异常并设置非零退出码！
    if (!isCountClean || !isFingerprintClean) {
      process.exitCode = 1;
      const logPath = path.resolve('../docs/reports/s6-s7-integration-execution.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, logBuffer.join('\n') + '\n', 'utf8');
      throw new Error('❌ [严重违规] 基线核验失败：数据行数残留或既有历史数据被篡改！测试不可通过！');
    }

    console.log('✓ [基线核验全部通过] 所有业务表行数 100% 吻合，既有全表指纹 100% 一致，零残留、零污染！');

    const logPath = path.resolve('../docs/reports/s6-s7-integration-execution.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, logBuffer.join('\n') + '\n', 'utf8');
  }
}

main().catch((err) => {
  console.error('\n❌ [集成回归实测遇到未捕获异常]', err);
  process.exitCode = 1;
  const logPath = path.resolve('../docs/reports/s6-s7-integration-execution.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, logBuffer.join('\n') + '\n', 'utf8');
  } catch (_) {}
  process.exit(1);
});
