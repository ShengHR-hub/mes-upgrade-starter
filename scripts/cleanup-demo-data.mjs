// Demo data cleanup for smart_mes (local dev database only).
//
// Safety design (2026-10-16 review fix):
//   1. DRY-RUN BY DEFAULT: `node scripts/cleanup-demo-data.mjs` only reports what WOULD be
//      deleted (counts + rows) and exits without touching anything.
//      Execute only with the explicit confirm flag: `--confirm` (or env CLEANUP_CONFIRM=1).
//   2. TRANSACTION: all deletes/updates run in a single transaction; any error rolls back
//      completely, so a mid-way failure cannot leave partial cleanup state.
//   3. PREFIX SAFETY: DEMO-% is a naming convention. The pre-check lists every matching
//      sale_order row; any code NOT matching the two generator patterns
//      (DEMO-SO-YYYYMMDD-NN / DEMO-SO-D-YYYYMMDD) is flagged as suspicious and BLOCKS
//      execution unless --force is also given (never use --force without inspecting rows).
//   4. Alerts / equipment logs are selected by the unique generator marker string
//      (not by date), so historical-timestamped demo rows are also covered.
//   5. product master data (14 rows) is intentionally KEPT (master data repair, not demo data).
//
// Usage:
//   node scripts/cleanup-demo-data.mjs            # dry-run: report only
//   node scripts/cleanup-demo-data.mjs --confirm  # execute (transactional)
//   node scripts/cleanup-demo-data.mjs --confirm --force  # execute despite suspicious rows
import mysql from '../backend/node_modules/mysql2/promise.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dotenv = require('../backend/node_modules/dotenv/dist/index.cjs');
const envPath = decodeURIComponent(new URL('../backend/.env', import.meta.url).pathname).replace(/^\//, '');
dotenv.config({ path: envPath, override: false });

const CONFIRM = process.argv.includes('--confirm') || process.env.CLEANUP_CONFIRM === '1';
const FORCE = process.argv.includes('--force');
const MARK = '演示数据·非真实业务·2026-10-16生成';
// patterns produced by the two generator scripts
const PATTERN_MAIN = /^DEMO-SO-\d{8}-\d{2}$/;
const PATTERN_DAILY = /^DEMO-SO-D-\d{8}$/;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE,
  charset: process.env.DB_CHARSET || 'utf8mb4',
  multipleStatements: false,
});

function say(s) { console.log(s); }

async function main() {
  // ---------------- pre-check ----------------
  const [orderRows] = await conn.execute(
    "SELECT id, code, created_at FROM sale_order WHERE code LIKE 'DEMO-%' ORDER BY id",
  );
  const orderIds = orderRows.map((o) => o.id);
  say('Matching sale_order rows (code LIKE DEMO-%): ' + orderRows.length);
  for (const o of orderRows) say('  - id=' + o.id + ' code=' + o.code + ' created_at=' + o.created_at);

  const suspicious = orderRows.filter((o) => !PATTERN_MAIN.test(o.code) && !PATTERN_DAILY.test(o.code));
  if (suspicious.length > 0) {
    say('SUSPICIOUS: ' + suspicious.length + ' row(s) do not match generator naming patterns —' +
      ' they may be pre-existing business data that happens to use the DEMO- prefix.');
    say('Execution is BLOCKED. Inspect the rows above; re-run with --confirm --force only if they are truly demo data.');
  }

  if (orderIds.length === 0) {
    say('Nothing to clean (no DEMO-% orders). product master data untouched. CLEANUP_NOTHING_TO_DO');
    return;
  }

  const [woRows] = await conn.query('SELECT id, code FROM work_order WHERE sale_order_id IN (?)', [orderIds]);
  const woIds = woRows.map((w) => w.id);
  say('Work orders to delete: ' + woIds.length + (woIds.length ? ' (' + woRows.map((w) => w.code).join(', ') + ')' : ''));
  const [taskRows] = woIds.length
    ? await conn.query('SELECT id FROM work_task WHERE work_order_id IN (?)', [woIds])
    : [[]];
  const taskIds = taskRows.map((t) => t.id);
  say('Tasks to delete: ' + taskIds.length);
  const [reportRows] = taskIds.length
    ? await conn.query('SELECT id FROM report WHERE task_id IN (?)', [taskIds])
    : [[]];
  const reportIds = reportRows.map((r) => r.id);
  say('Reports to delete: ' + reportIds.length);
  const [qcRows] = woIds.length
    ? await conn.query('SELECT id FROM qc_record WHERE work_order_id IN (?)', [woIds])
    : [[]];
  const qcIds = qcRows.map((q) => q.id);
  const [defectRows] = qcIds.length
    ? await conn.query('SELECT id FROM defect WHERE qc_record_id IN (?)', [qcIds])
    : [[]];
  const defectIds = defectRows.map((d) => d.id);
  say('QC records to delete: ' + qcIds.length + ' (linked defects: ' + defectIds.length + ')');
  const [snRows] = woIds.length
    ? await conn.query('SELECT id FROM sn_trace WHERE work_order_id IN (?)', [woIds])
    : [[]];
  const snIds = snRows.map((s) => s.id);
  say('SN traces to delete: ' + snIds.length);
  const [batchRows] = await conn.query("SELECT id, batch_no FROM material_batch WHERE batch_no LIKE 'DEMO-%'");
  const batchIds = batchRows.map((b) => b.id);
  say('Batches to delete: ' + batchIds.length + (batchIds.length ? ' (' + batchRows.map((b) => b.batch_no).join(', ') + ')' : ''));
  // marker-based selection (covers historical timestamps), plus WO-linked alerts
  const [alertRows] = await conn.query(
    'SELECT id, title FROM alert WHERE content LIKE ? OR (ref_type = ? AND ref_id IN (?))',
    ['%' + MARK + '%', 'work_order', woIds],
  );
  say('Alerts to delete: ' + alertRows.length + (alertRows.length ? ' (' + alertRows.map((a) => a.id + ':' + a.title.slice(0, 18)).join(' | ') + ')' : ''));
  const [eqRows] = await conn.query(
    'SELECT id FROM equipment_log WHERE remark LIKE ?',
    ['%' + MARK + '%'],
  );
  say('Equipment logs to delete: ' + eqRows.length);

  if (!CONFIRM) {
    say('DRY-RUN ONLY — nothing was deleted. Re-run with --confirm to execute (transactional).');
    return;
  }
  if (suspicious.length > 0 && !FORCE) {
    say('ABORTED: suspicious rows present and --force not given. CLEANUP_ABORTED');
    process.exitCode = 2;
    return;
  }

  // ---------------- transactional execution ----------------
  await conn.beginTransaction();
  try {
    if (batchIds.length) {
      await conn.query('UPDATE sn_trace SET batch_id = NULL WHERE batch_id IN (?)', [batchIds]);
      await conn.query('DELETE FROM material_batch WHERE id IN (?)', [batchIds]);
    }
    if (snIds.length) await conn.query('DELETE FROM sn_trace WHERE id IN (?)', [snIds]);
    if (defectIds.length) await conn.query('DELETE FROM defect WHERE id IN (?)', [defectIds]);
    if (qcIds.length) await conn.query('DELETE FROM qc_record WHERE id IN (?)', [qcIds]);
    if (reportIds.length) await conn.query('DELETE FROM report WHERE id IN (?)', [reportIds]);
    await conn.query('DELETE FROM alert WHERE content LIKE ? OR (ref_type = ? AND ref_id IN (?))',
      ['%' + MARK + '%', 'work_order', woIds]);
    await conn.query('DELETE FROM equipment_log WHERE remark LIKE ?', ['%' + MARK + '%']);
    if (woIds.length) {
      await conn.query('DELETE FROM work_task WHERE work_order_id IN (?)', [woIds]);
      await conn.query('DELETE FROM work_order WHERE id IN (?)', [woIds]);
    }
    await conn.query('DELETE FROM sale_order WHERE id IN (?)', [orderIds]);
    await conn.commit();
    say('CLEANUP_DONE (committed).');
  } catch (err) {
    await conn.rollback();
    say('ERROR — rolled back completely: ' + (err?.message || err));
    process.exitCode = 1;
    return;
  }

  const [p] = await conn.execute('SELECT COUNT(*) c FROM product');
  say('product rows kept (master data): ' + p[0].c);
}

try {
  await main();
} finally {
  await conn.end();
}
