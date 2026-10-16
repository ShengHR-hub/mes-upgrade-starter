// Additional demo work orders: one completed per day (2026-10-10..10-16), so the daily
// report and 7-day trend have real output on every day (末道工序口径: only final-task
// reports count toward daily output, per S7 aggregation design).
// Companion to scripts/generate-demo-data.mjs; both are authorized demo data for the
// local dev database only. All rows carry DEMO codes/SNs and are recorded for cleanup.
import mysql from '../backend/node_modules/mysql2/promise.js';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dotenv = require('../backend/node_modules/dotenv/dist/index.cjs');
const envPath = decodeURIComponent(new URL('../backend/.env', import.meta.url).pathname).replace(/^\//, '');
dotenv.config({ path: envPath, override: false });

const MARK = '演示数据·非真实业务·2026-10-16生成';
const IDS_FILE = process.env.TEMP + '/mes-demo-daily-ids.json';
const OUT_FILE = process.env.TEMP + '/mes-demo-daily.json';
const log = [];

/** Local (GMT+8 machine) today as YYYY-MM-DD — used to keep today's report
 *  timestamps before the current moment (daily-report snapshot boundary). */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const ids = { saleOrders: [], workOrders: [], tasks: [], reports: [], qcRecords: [], defects: [], snTraces: [] };

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE,
  charset: process.env.DB_CHARSET || 'utf8mb4',
});
try {
  // idempotency
  const [existing] = await conn.execute("SELECT id FROM sale_order WHERE code LIKE 'DEMO-SO-D-%' LIMIT 1");
  if (existing.length) {
    log.push('ABORT: day demo orders already exist');
    writeFileSync(OUT_FILE, JSON.stringify({ aborted: true, log }, null, 1), 'utf8');
    await conn.end();
    process.exit(0);
  }
  const [users] = await conn.execute(
    "SELECT id, username FROM sys_user WHERE username IN ('planner01','op_smt_01','op_assy_01','qc_inspector_01','wh_keeper_01')",
  );
  const uid = Object.fromEntries(users.map((u) => [u.username, Number(u.id)]));
  const [batches] = await conn.execute("SELECT id, batch_no FROM material_batch WHERE batch_no LIKE 'DEMO-%' ORDER BY id");
  const [route] = await conn.execute(
    'SELECT seq, step_name, workshop, prod_line, key_device FROM process_route WHERE product_code = ? ORDER BY seq',
    ['JC-PLC-2001'],
  );

  // day -> [qty, dueDate, finalGood, finalBad, aoingNg(0=OK检/1=NG检)]
  const daySpecs = [
    ['2026-10-10', 20, '2026-10-11', 18, 2, 0],
    ['2026-10-11', 25, '2026-10-12', 23, 2, 1],
    ['2026-10-12', 22, '2026-10-13', 20, 2, 0],
    ['2026-10-13', 28, '2026-10-14', 26, 2, 0],
    ['2026-10-15', 24, '2026-10-16', 22, 2, 1],
    ['2026-10-16', 30, '2026-10-17', 28, 2, 0],
  ];

  let snSeq = 100;
  for (const [day, qty, due, fGood, fBad, aoingNg] of daySpecs) {
    const dayTag = day.replaceAll('-', '');
    // sale order
    const [so] = await conn.execute(
      'INSERT INTO sale_order (code, product_code, qty, due_date, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
      [`DEMO-SO-D-${dayTag}`, 'JC-PLC-2001', qty, due, '已完成', uid.planner01, `${day} 08:00:00`],
    );
    const soId = so.insertId;
    ids.saleOrders.push(soId);
    // work order
    const [wo] = await conn.execute(
      'INSERT INTO work_order (code, sale_order_id, product_code, qty, done_qty, status, plan_start, plan_end, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [`DEMO-WO-${dayTag}`, soId, 'JC-PLC-2001', qty, fGood, '完工', day, day, uid.planner01, `${day} 08:05:00`],
    );
    const woId = wo.insertId;
    ids.workOrders.push(woId);

    // tasks + reports (one report per task, all on `day`)
    // TODAY special-case: report timestamps must be BEFORE now — the daily-report
    // snapshot boundary (reported_at <= snapshotAt) filters future reports, which
    // silently zeroes out today's output. Use 06:30 + seq*15min for today; historical
    // days keep the hourly 08:00.. scheme.
    const isToday = day === todayLocal();
    let hour = 8;
    for (const step of route) {
      const isFinal = Number(step.seq) === route.length;
      const good = isFinal ? fGood : qty - (fBad > 0 && Number(step.seq) % 3 === 0 ? 1 : 0);
      const bad = isFinal ? fBad : (fBad > 0 && Number(step.seq) % 3 === 0 ? 1 : 0);
      let started;
      let finished;
      if (isToday) {
        started = `${day} ${String(6 + Math.floor((step.seq - 1) / 4)).padStart(2, '0')}:${String(((step.seq - 1) % 4) * 15).padStart(2, '0')}:00`;
        const endMin = ((step.seq - 1) % 4) * 15 + 10;
        const endHour = 6 + Math.floor((step.seq - 1) / 4) + Math.floor(endMin / 60);
        finished = `${day} ${String(endHour).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
      } else {
        started = `${day} ${String(hour).padStart(2, '0')}:00:00`;
        hour += 1;
        finished = `${day} ${String(hour).padStart(2, '0')}:00:00`;
      }
      const [t] = await conn.execute(
        'INSERT INTO work_task (work_order_id, seq, step_name, workshop, prod_line, device_code, operator_id, plan_qty, good_qty, bad_qty, status, plan_start, plan_end, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [woId, step.seq, step.step_name, step.workshop, step.prod_line, step.key_device, Number(step.seq) <= 4 ? uid.op_smt_01 : uid.op_assy_01, qty, good, bad, '完工', started, finished, started, finished],
      );
      ids.tasks.push(t.insertId);
      const [r] = await conn.execute(
        'INSERT INTO report (task_id, user_id, good_qty, bad_qty, reported_at) VALUES (?,?,?,?,?)',
        [t.insertId, Number(step.seq) <= 4 ? uid.op_smt_01 : uid.op_assy_01, good, bad, finished],
      );
      ids.reports.push(r.insertId);
      if (isFinal) {
        // FQC on final task
        const [q] = await conn.execute(
          'INSERT INTO qc_record (work_order_id, task_id, result, check_qty, ng_qty, inspector_id, checked_at, remark) VALUES (?,?,?,?,?,?,?,?)',
          [woId, t.insertId, fBad > 0 ? 'NG' : 'OK', good + bad, fBad, uid.qc_inspector_01, finished, `FQC全检·${MARK}`],
        );
        ids.qcRecords.push(q.insertId);
        if (fBad > 0) {
          const [d] = await conn.execute(
            'INSERT INTO defect (qc_record_id, defect_type, qty, step_name, description) VALUES (?,?,?,?,?)',
            [q.insertId, '虚焊', fBad, step.step_name, `FQC检出·${MARK}`],
          );
          ids.defects.push(d.insertId);
        }
        // AOI NG variant on seq 4 for selected days
        if (aoingNg) {
          const aoTask = ids.tasks[ids.tasks.length - route.length + 3];
          const [q2] = await conn.execute(
            'INSERT INTO qc_record (work_order_id, task_id, result, check_qty, ng_qty, inspector_id, checked_at, remark) VALUES (?,?,?,?,?,?,?,?)',
            [woId, aoTask, 'NG', qty - 2, 2, uid.qc_inspector_01, `${day} 12:00:00`, `AOI焊点检测·${MARK}`],
          );
          ids.qcRecords.push(q2.insertId);
          for (const [type, n] of [['虚焊', 1], ['连锡', 1]]) {
            const [d] = await conn.execute(
              'INSERT INTO defect (qc_record_id, defect_type, qty, step_name, description) VALUES (?,?,?,?,?)',
              [q2.insertId, type, n, 'AOI光学检测', `AOI检出·${MARK}`],
            );
            ids.defects.push(d.insertId);
          }
        }
      }
    }
    // 2 sn traces per day-WO on the final task
    const finalTaskId = ids.tasks[ids.tasks.length - 1];
    const snTime = isToday ? `${day} 10:00:00` : `${day} ${String(hour + 1).padStart(2, '0')}:00:00`;
    for (let i = 0; i < 2; i++) {
      snSeq++;
      const [s] = await conn.execute(
        'INSERT INTO sn_trace (sn, work_order_id, product_code, task_id, operator_id, device_code, batch_id, qc_result, produced_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [`SN-DEMO-D-${String(snSeq).padStart(3, '0')}`, woId, 'JC-PLC-2001', finalTaskId, uid.wh_keeper_01, 'EQP-ASSY-003', batches[i % batches.length].id, i === 0 ? 'OK' : 'NG', snTime],
      );
      ids.snTraces.push(s.insertId);
    }
    log.push(`day-WO ${day}: qty=${qty} final good=${fGood} (${ids.tasks.length} tasks so far)`);
  }

  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1), 'utf8');
  const [counts] = await conn.execute(
    "SELECT (SELECT COUNT(*) FROM sale_order) so, (SELECT COUNT(*) FROM work_order) wo, (SELECT COUNT(*) FROM work_task) wt, (SELECT COUNT(*) FROM report) rp, (SELECT COUNT(*) FROM qc_record) qc, (SELECT COUNT(*) FROM defect) df, (SELECT COUNT(*) FROM sn_trace) sn",
  );
  log.push('final counts: ' + JSON.stringify(counts[0]));
  log.push('DAILY_WOS_DONE');
} finally {
  await conn.end();
}
writeFileSync(OUT_FILE, JSON.stringify({ done: true, ids, log }, null, 1), 'utf8');
