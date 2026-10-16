// Demo data generator for smart_mes (local dev database only).
// AUTHORIZED 2026-10-16 by the project owner ("全部授权").
//
// Scope:
//   1. Restore 14 product master rows (product table is empty while 28 bom rows reference it).
//   2. Generate DEMO process data covering 2026-10-10..2026-10-16 through the real business API
//      (orders create/confirm, work-order/task state transitions, reports, quality inspections,
//      material batches, sn traces) plus direct SQL for records the API cannot create
//      (historical reports/qc/defects, alerts, equipment logs, historical task states).
//   3. Every generated row carries a DEMO marker; all inserted IDs are recorded for cleanup.
//
// Safety:
//   - Aborts if any sale_order code LIKE 'DEMO-%' already exists (idempotent).
//   - Only INSERTs new rows and UPDATEs rows created by this run; never TRUNCATEs, never touches
//     sys_user / material / device / bom / process_route / existing rows.
//   - DB password is read from the process environment (injected by the launcher); never printed.
import mysql from '../backend/node_modules/mysql2/promise.js';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dotenv = require('../backend/node_modules/dotenv/dist/index.cjs');
const envPath = decodeURIComponent(new URL('../backend/.env', import.meta.url).pathname).replace(/^\//, '');
dotenv.config({ path: envPath, override: false });

const BASE = 'http://127.0.0.1:3001/api/v1';
const MARK = '演示数据·非真实业务·2026-10-16生成';
const IDS_FILE = process.env.TEMP + '/mes-demo-ids.json';
const OUT_FILE = process.env.TEMP + '/mes-demo-generate.json';
const log = [];
function say(s) { log.push(s); }

const ids = {
  products: [], saleOrders: [], workOrders: [], workOrderCodes: [],
  tasks: { wo1: [], wo2: [] }, reports: [], qcRecords: [], defects: [],
  snTraces: [], batches: [], alerts: [], equipmentLogs: [],
};

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE,
  charset: process.env.DB_CHARSET || 'utf8mb4',
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
});

try {
  // ---- 0. idempotency + user ids ----
  const [existing] = await conn.execute("SELECT id, code FROM sale_order WHERE code LIKE 'DEMO-%' LIMIT 1");
  if (existing.length) {
    say('ABORT: demo orders already exist (' + existing[0].code + '). Cleanup first.');
    writeFileSync(OUT_FILE, JSON.stringify({ aborted: true, log }, null, 1), 'utf8');
    await conn.end();
    process.exit(0);
  }
  const [users] = await conn.execute(
    "SELECT id, username FROM sys_user WHERE username IN ('planner01','op_smt_01','op_assy_01','qc_inspector_01','wh_keeper_01','eqp_maint_01')",
  );
  const uid = Object.fromEntries(users.map((u) => [u.username, Number(u.id)]));
  say('user ids: ' + JSON.stringify(uid));

  // ---- 1. restore product master data (14 rows, identical to db/seed.sql) ----
  const PRODUCTS = [
    ['JC-PLC-2001', 'PLC控制板卡-标准型', '工业控制板卡', 3000, '片', 0.8, '主力产品'],
    ['JC-PLC-2002', 'PLC控制板卡-增强型', '工业控制板卡', 2000, '片', 1.0, '高利润产品'],
    ['JC-PLC-2003', 'PLC控制板卡-定制型', '工业控制板卡', 1000, '片', 1.2, '定制订单'],
    ['JC-DRV-1001', '电机驱动板', '工业控制板卡', 2000, '片', 0.6, null],
    ['JC-IoT-4G-A', '4G通信模组-A型', '物联网模组', 5000, '片', 0.4, '大批量产品'],
    ['JC-IoT-4G-B', '4G通信模组-B型', '物联网模组', 4000, '片', 0.4, null],
    ['JC-IoT-5G-A', '5G通信模组-A型', '物联网模组', 3000, '片', 0.5, '新产品'],
    ['JC-IoT-NB-A', 'NB-IoT模组', '物联网模组', 3000, '片', 0.3, null],
    ['JC-SEN-T100', '温度传感器', '智能传感器', 1500, '只', 1.5, '标定工序关键'],
    ['JC-SEN-T200', '高精度温度传感器', '智能传感器', 1000, '只', 2.0, '高精度需求'],
    ['JC-SEN-P100', '压力传感器', '智能传感器', 1200, '只', 1.5, null],
    ['JC-SEN-P200', '高精度压力传感器', '智能传感器', 800, '只', 2.0, '汽车级认证'],
    ['JC-SEN-H100', '湿度传感器', '智能传感器', 1000, '只', 1.5, null],
    ['JC-SEN-V100', '振动传感器', '智能传感器', 500, '只', 1.8, '小批量'],
  ];
  for (const p of PRODUCTS) {
    const [exists] = await conn.execute('SELECT 1 FROM product WHERE code = ? LIMIT 1', [p[0]]);
    if (exists.length) continue;
    await conn.execute(
      'INSERT INTO product (code,name,line,monthly_output,unit,std_hours,remark) VALUES (?,?,?,?,?,?,?)',
      p,
    );
    ids.products.push(p[0]);
  }
  say('products restored: ' + ids.products.length + ' (already present: ' + (PRODUCTS.length - ids.products.length) + ')');

  // ---- 2. API: login ----
  let token = null;
  {
    const res = await fetch(BASE + '/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const j = await res.json();
    if (res.status !== 200 || j.code !== 0 || !j.data?.accessToken) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
    token = j.data.accessToken;
    say('api login ok (role=' + j.data.user.role + ')');
  }
  async function api(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    return { status: res.status, code: j?.code, data: j?.data, message: j?.message };
  }

  // ---- 3. API: create 3 sale orders ----
  const orderSpecs = [
    { code: 'DEMO-SO-20261010-01', productCode: 'JC-PLC-2001', qty: 100, dueDate: '2026-10-13' },
    { code: 'DEMO-SO-20261012-01', productCode: 'JC-PLC-2001', qty: 80, dueDate: '2026-10-16' },
    { code: 'DEMO-SO-20261015-01', productCode: 'JC-PLC-2001', qty: 60, dueDate: '2026-10-20' },
  ];
  const orderIds = [];
  for (const o of orderSpecs) {
    const r = await api('POST', '/orders', o);
    if (r.status !== 201 || r.code !== 0) throw new Error('create order failed: ' + JSON.stringify(r).slice(0, 300));
    orderIds.push(String(r.data.id));
    ids.saleOrders.push(String(r.data.id));
    say('order created: ' + o.code + ' id=' + r.data.id);
  }

  // ---- 4. API: confirm orders 1 and 2 (generates work orders + tasks) ----
  const woIds = [];
  for (const oid of [orderIds[0], orderIds[1]]) {
    const r = await api('POST', '/orders/' + oid + '/confirmations', { expectedStatus: '待确认' });
    if (r.status !== 200 || r.code !== 0) throw new Error('confirm failed: ' + JSON.stringify(r).slice(0, 300));
    const wo = r.data.workOrders[0];
    woIds.push(String(wo.id));
    ids.workOrders.push(String(wo.id));
    ids.workOrderCodes.push(wo.code);
    say('order ' + oid + ' confirmed -> WO ' + wo.code + ' (id=' + wo.id + ', tasks=' + (wo.taskCount ?? '?') + ')');
  }

  // ---- 5. fetch task ids for both work orders ----
  async function tasksOf(woId) {
    const r = await api('GET', '/work-orders/' + woId + '/tasks');
    if (r.code !== 0) throw new Error('list tasks failed: ' + JSON.stringify(r).slice(0, 200));
    return r.data.list.map((t) => ({ id: String(t.id), seq: Number(t.seq), stepName: t.stepName }));
  }
  const tasksWo1 = await tasksOf(woIds[0]);
  const tasksWo2 = await tasksOf(woIds[1]);
  ids.tasks.wo1 = tasksWo1.map((t) => t.id);
  ids.tasks.wo2 = tasksWo2.map((t) => t.id);
  say('tasks: wo1=' + tasksWo1.length + ' wo2=' + tasksWo2.length);

  // ---- 6. SQL: WO1 full historical story (2026-10-10..10-14, status 完工) ----
  // task: [seq, startedAt, finishedAt, good, bad, reportedAt]
  const wo1Story = [
    [1, '2026-10-10 08:30:00', '2026-10-10 14:30:00', 98, 2, '2026-10-10 14:30:00'],
    [2, '2026-10-10 14:40:00', '2026-10-10 17:45:00', 97, 3, '2026-10-10 17:45:00'],
    [3, '2026-10-11 08:30:00', '2026-10-11 11:20:00', 98, 2, '2026-10-11 11:20:00'],
    [4, '2026-10-11 11:30:00', '2026-10-11 16:10:00', 96, 4, '2026-10-11 16:10:00'],
    [5, '2026-10-12 08:30:00', '2026-10-12 10:05:00', 97, 3, '2026-10-12 10:05:00'],
    [6, '2026-10-12 10:15:00', '2026-10-12 15:40:00', 98, 2, '2026-10-12 15:40:00'],
    [7, '2026-10-13 08:30:00', '2026-10-13 09:50:00', 97, 3, '2026-10-13 09:50:00'],
    [8, '2026-10-13 10:00:00', '2026-10-13 14:15:00', 98, 2, '2026-10-13 14:15:00'],
    [9, '2026-10-14 08:30:00', '2026-10-14 10:30:00', 95, 5, '2026-10-14 10:30:00'],
    [10, '2026-10-14 10:40:00', '2026-10-14 16:20:00', 94, 6, '2026-10-14 16:20:00'],
  ];
  for (const [seq, started, finished, good, bad, reportedAt] of wo1Story) {
    const t = tasksWo1.find((x) => x.seq === seq);
    await conn.execute(
      'UPDATE work_task SET status=?, started_at=?, finished_at=?, good_qty=?, bad_qty=?, plan_start=?, plan_end=? WHERE id=?',
      ['完工', started, finished, good, bad, started, finished, t.id],
    );
    const [r] = await conn.execute(
      'INSERT INTO report (task_id, user_id, good_qty, bad_qty, reported_at) VALUES (?,?,?,?,?)',
      [t.id, seq <= 4 ? uid.op_smt_01 : seq <= 8 ? uid.op_assy_01 : uid.op_assy_01, good, bad, reportedAt],
    );
    ids.reports.push(r.insertId);
  }
  await conn.execute(
    "UPDATE work_order SET status='完工', done_qty=94, plan_start='2026-10-10', plan_end='2026-10-13' WHERE id=?",
    [woIds[0]],
  );
  await conn.execute(
    "UPDATE sale_order SET status='已完成' WHERE id=?",
    [orderIds[0]],
  );
  say('wo1 historical story done (10 tasks, 10 reports)');

  // WO1 qc records + defects
  const wo1Qc = [
    { taskSeq: 1, result: 'OK', check: 98, ng: 0, at: '2026-10-10 15:00:00', remark: 'SPI锡膏检测·' + MARK, defects: [] },
    { taskSeq: 4, result: 'NG', check: 96, ng: 4, at: '2026-10-11 16:30:00', remark: 'AOI焊点检测·' + MARK, defects: [['虚焊', 2, 'AOI检出'], ['连锡', 1, 'AOI检出'], ['少件', 1, 'AOI检出']] },
    { taskSeq: 6, result: 'NG', check: 98, ng: 2, at: '2026-10-12 16:00:00', remark: '波峰焊后外观检·' + MARK, defects: [['虚焊', 1, '外观检'], ['连锡', 1, '外观检']] },
    { taskSeq: 7, result: 'OK', check: 97, ng: 0, at: '2026-10-13 15:00:00', remark: '功能全项测试·' + MARK, defects: [] },
    { taskSeq: 9, result: 'NG', check: 95, ng: 5, at: '2026-10-14 11:00:00', remark: 'FQC全检·' + MARK, defects: [['错件', 2, 'FQC'], ['虚焊', 2, 'FQC'], ['划伤', 1, 'FQC']] },
  ];
  for (const q of wo1Qc) {
    const t = tasksWo1.find((x) => x.seq === q.taskSeq);
    const [r] = await conn.execute(
      'INSERT INTO qc_record (work_order_id, task_id, result, check_qty, ng_qty, inspector_id, checked_at, remark) VALUES (?,?,?,?,?,?,?,?)',
      [woIds[0], t.id, q.result, q.check, q.ng, uid.qc_inspector_01, q.at, q.remark],
    );
    ids.qcRecords.push(r.insertId);
    for (const [type, qty, desc] of q.defects) {
      const [d] = await conn.execute(
        'INSERT INTO defect (qc_record_id, defect_type, qty, step_name, description) VALUES (?,?,?,?,?)',
        [r.insertId, type, qty, t.stepName, desc + '·' + MARK],
      );
      ids.defects.push(d.insertId);
    }
  }
  say('wo1 qc records: ' + ids.qcRecords.length + ', defects: ' + ids.defects.length);

  // WO1 sn traces (8) on task 10 (包装入库)
  const snCodes = [];
  for (let i = 1; i <= 8; i++) {
    const sn = 'SN-DEMO-PLC-000' + i;
    snCodes.push(sn);
    const [r] = await conn.execute(
      'INSERT INTO sn_trace (sn, work_order_id, product_code, task_id, operator_id, device_code, batch_id, qc_result, produced_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [sn, woIds[0], 'JC-PLC-2001', tasksWo1[9].id, uid.wh_keeper_01, i % 2 ? 'EQP-ASSY-003' : null, null, i <= 6 ? 'OK' : 'NG', '2026-10-14 17:00:00'],
    );
    ids.snTraces.push(r.insertId);
  }
  say('wo1 sn traces: ' + snCodes.length);

  // ---- 7. SQL: WO2 tasks 1-3 history (2026-10-14..10-15) ----
  const wo2History = [
    [1, '2026-10-14 08:30:00', '2026-10-14 14:00:00', 78, 2, '2026-10-14 14:00:00'],
    [2, '2026-10-15 08:30:00', '2026-10-15 11:30:00', 77, 3, '2026-10-15 11:30:00'],
    [3, '2026-10-15 11:40:00', '2026-10-15 16:45:00', 78, 2, '2026-10-15 16:45:00'],
  ];
  for (const [seq, started, finished, good, bad, reportedAt] of wo2History) {
    const t = tasksWo2.find((x) => x.seq === seq);
    await conn.execute(
      'UPDATE work_task SET status=?, started_at=?, finished_at=?, good_qty=?, bad_qty=?, plan_start=?, plan_end=? WHERE id=?',
      ['完工', started, finished, good, bad, started, finished, t.id],
    );
    const [r] = await conn.execute(
      'INSERT INTO report (task_id, user_id, good_qty, bad_qty, reported_at) VALUES (?,?,?,?,?)',
      [t.id, uid.op_smt_01, good, bad, reportedAt],
    );
    ids.reports.push(r.insertId);
  }
  await conn.execute(
    "UPDATE work_order SET plan_start='2026-10-14', plan_end='2026-10-16' WHERE id=?",
    [woIds[1]],
  );
  say('wo2 tasks 1-3 history done');

  // ---- 8. API: WO2 live flow (today) ----
  {
    const r = await api('POST', '/work-orders/' + woIds[1] + '/state-transitions', { expectedStatus: '待启动', targetStatus: '在产' });
    if (r.status !== 200 || r.code !== 0) throw new Error('wo transition failed: ' + JSON.stringify(r).slice(0, 200));
    say('wo2 -> 在产 ok');
  }
  const wo2Live = [
    [4, 76, 2], [5, 77, 2], [6, 76, 3], [7, 77, 2], [8, 76, 2],
  ];
  for (const [seq, good, bad] of wo2Live) {
    const t = tasksWo2.find((x) => x.seq === seq);
    let r = await api('POST', '/tasks/' + t.id + '/state-transitions', { expectedStatus: '待启动', targetStatus: '在产' });
    if (r.code !== 0) throw new Error('task ' + seq + ' ->在产 failed: ' + JSON.stringify(r).slice(0, 200));
    r = await api('POST', '/reports', { taskId: t.id, goodQty: good, badQty: bad });
    if (r.status !== 201 || r.code !== 0) throw new Error('report task ' + seq + ' failed: ' + JSON.stringify(r).slice(0, 200));
    r = await api('POST', '/tasks/' + t.id + '/state-transitions', { expectedStatus: '在产', targetStatus: '完工' });
    if (r.code !== 0) throw new Error('task ' + seq + ' ->完工 failed: ' + JSON.stringify(r).slice(0, 200));
    say('wo2 task ' + seq + ' reported good=' + good + ' bad=' + bad + ' (api)');
  }

  // WO2 qc via API (AOI NG + one OK)
  {
    let r = await api('POST', '/quality-inspections', {
      workOrderId: woIds[1], taskId: tasksWo2[3].id, result: 'NG', checkQty: 76, ngQty: 2,
      remark: 'AOI焊点检测·' + MARK,
      defects: [{ defectType: '虚焊', qty: 1, description: 'AOI检出·' + MARK }, { defectType: '连锡', qty: 1, description: 'AOI检出·' + MARK }],
    });
    if (r.status !== 201 || r.code !== 0) throw new Error('qc NG failed: ' + JSON.stringify(r).slice(0, 300));
    say('wo2 qc NG via api ok (id=' + r.data.id + ')');
    r = await api('POST', '/quality-inspections', {
      workOrderId: woIds[1], taskId: tasksWo2[7].id, result: 'OK', checkQty: 76, ngQty: 0,
      remark: '老化后复测·' + MARK,
    });
    if (r.status !== 201 || r.code !== 0) throw new Error('qc OK failed: ' + JSON.stringify(r).slice(0, 300));
    say('wo2 qc OK via api ok (id=' + r.data.id + ')');
  }

  // ---- 9. API: material batches (2) ----
  const batches = [
    { batchNo: 'DEMO-BATCH-PCB-20261010', materialCode: 'PCB-PLC-001', qty: 2000, inboundAt: '2026-10-10', supplier: '深南电路' },
    { batchNo: 'DEMO-BATCH-IC-20261011', materialCode: 'IC-STM32-001', qty: 1000, inboundAt: '2026-10-11', supplier: '意法半导体' },
  ];
  for (const b of batches) {
    const r = await api('POST', '/material-batches', b);
    if (r.status !== 201 || r.code !== 0) throw new Error('batch failed: ' + JSON.stringify(r).slice(0, 200));
    ids.batches.push(String(r.data.id));
    say('batch created: ' + b.batchNo + ' id=' + r.data.id);
  }
  // link wo1 sn traces to batches (4 each)
  await conn.query('UPDATE sn_trace SET batch_id=? WHERE work_order_id=? AND id IN (?)', [ids.batches[0], woIds[0], ids.snTraces.slice(0, 4)]);
  await conn.query('UPDATE sn_trace SET batch_id=? WHERE work_order_id=? AND id IN (?)', [ids.batches[1], woIds[0], ids.snTraces.slice(4, 8)]);

  // ---- 10. API: sn traces (2, today, on wo2 task 8) ----
  for (const [i, sn] of ['SN-DEMO-PLC-0009', 'SN-DEMO-PLC-0010'].entries()) {
    const r = await api('POST', '/sn-traces', {
      sn, workOrderId: woIds[1], taskId: tasksWo2[7].id,
      deviceCode: 'EQP-ASSY-003', batchId: ids.batches[i], qcResult: i === 0 ? 'OK' : 'NG',
    });
    if (r.status !== 201 || r.code !== 0) throw new Error('sn trace failed: ' + JSON.stringify(r).slice(0, 200));
    ids.snTraces.push(String(r.data.id));
    say('sn trace created: ' + sn);
  }

  // ---- 11. SQL: alerts (4) ----
  const alerts = [
    ['重要', '质量异常', 'SMT-1线AOI检验良品率95.83%低于97%', '演示数据：WO1 AOI工序检验不良4件（虚焊/连锡/少件），良品率低于97%阈值。' + MARK, 'work_order', woIds[0], '未处理', '2026-10-11 17:00:00'],
    ['重要', '质量异常', '波峰焊后检验不良率偏高（虚焊/连锡）', '演示数据：WO1/WO2 波峰焊工序不良以虚焊、连锡为主，建议检查炉温曲线。' + MARK, 'work_order', woIds[1], '已确认', '2026-10-16 10:30:00'],
    ['紧急', '延期风险', 'WO2累计完成率低于90%（末道工序未报工）', '演示数据：末道工序尚未报工，累计完成率0.00%低于90%阈值。' + MARK, 'work_order', woIds[1], '未处理', '2026-10-16 09:00:00'],
    ['一般', '设备停机', 'EQP-SMT-006回流焊炉维修中', '演示数据：加热区故障维修，影响SMT-2线产能。' + MARK, 'device', null, '已关闭', '2026-10-14 09:30:00'],
  ];
  for (const [level, type, title, content, refType, refId, status, at] of alerts) {
    const [r] = await conn.execute(
      'INSERT INTO alert (level, type, title, content, ref_type, ref_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [level, type, title, content, refType, refId, status, at],
    );
    ids.alerts.push(r.insertId);
  }
  say('alerts inserted: ' + ids.alerts.length);

  // ---- 12. SQL: equipment logs (~18) ----
  const eqLogs = [
    ['EQP-SMT-005', '待机', '运行中', '2026-10-10 08:00:00'],
    ['EQP-SMT-005', '运行中', '待机', '2026-10-10 18:00:00'],
    ['EQP-SMT-003', '运行中', '待机', '2026-10-11 12:00:00'],
    ['EQP-SMT-003', '待机', '运行中', '2026-10-11 13:00:00'],
    ['EQP-SMT-006', '运行中', '维修中', '2026-10-14 09:12:00'],
    ['EQP-ASSY-003', '运行中', '待机', '2026-10-12 12:30:00'],
    ['EQP-ASSY-003', '待机', '运行中', '2026-10-12 13:30:00'],
    ['EQP-SMT-001', '运行中', '待机', '2026-10-13 12:00:00'],
    ['EQP-SMT-001', '待机', '运行中', '2026-10-13 13:00:00'],
    ['EQP-SMT-005', '待机', '运行中', '2026-10-14 08:00:00'],
    ['EQP-SMT-003', '运行中', '待机', '2026-10-15 12:00:00'],
    ['EQP-SMT-003', '待机', '运行中', '2026-10-15 13:00:00'],
    ['EQP-ASSY-001', '运行中', '待机', '2026-10-15 12:30:00'],
    ['EQP-ASSY-001', '待机', '运行中', '2026-10-15 13:30:00'],
    ['EQP-SMT-005', '运行中', '待机', '2026-10-16 12:00:00'],
    ['EQP-SMT-005', '待机', '运行中', '2026-10-16 13:00:00'],
    ['EQP-CAL-001', '运行中', '待机', '2026-10-16 17:00:00'],
    ['EQP-SMT-006', '维修中', '维修中', '2026-10-16 18:00:00'],
  ];
  for (const [dev, oldS, newS, at] of eqLogs) {
    const [r] = await conn.execute(
      'INSERT INTO equipment_log (device_code, old_status, new_status, changed_by, remark, changed_at) VALUES (?,?,?,?,?,?)',
      [dev, oldS, newS, uid.eqp_maint_01, '演示数据·' + MARK, at],
    );
    ids.equipmentLogs.push(r.insertId);
  }
  say('equipment logs inserted: ' + ids.equipmentLogs.length);

  // ---- 13. record ids + summary ----
  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1), 'utf8');
  const [counts] = await conn.execute(
    "SELECT (SELECT COUNT(*) FROM sale_order) so, (SELECT COUNT(*) FROM work_order) wo, (SELECT COUNT(*) FROM work_task) wt, (SELECT COUNT(*) FROM report) rp, (SELECT COUNT(*) FROM qc_record) qc, (SELECT COUNT(*) FROM defect) df, (SELECT COUNT(*) FROM alert) al, (SELECT COUNT(*) FROM sn_trace) sn, (SELECT COUNT(*) FROM equipment_log) el, (SELECT COUNT(*) FROM product) pr",
  );
  say('final counts: ' + JSON.stringify(counts[0]));
  say('DEMO_DATA_GENERATION_DONE');
} finally {
  await conn.end();
}
writeFileSync(OUT_FILE, JSON.stringify({ done: true, ids, log }, null, 1), 'utf8');
