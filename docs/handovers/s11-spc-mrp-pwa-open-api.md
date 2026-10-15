# S11 交接文档 —— SPC 质量分析 / MRP-lite / 移动端 PWA / 开放 API 边界

> 会话：S11（B11 SPC · B12 MRP-lite · B13 移动端 PWA · B14 开放 API 未启用边界）
> 日期：2026-10-14 / 2026-10-15
> 状态：**实现完成；复审第一轮 4 项 P2 已修复复测（§11.1—11.4），复审第二轮 1 项 P2 已修复复测（§11.6），提交「待独立审查」**。
> 本文件不宣布独立审查通过、真实 MySQL 业务验收或上线批准。
> 基线：S0—S10（S10 复审 P2 第二轮修复仍「待复审」，其产品行锁结论不由本会话改变）。

---

## 0. 范围核对（与任务书逐项对照）

| 任务书要求 | 本轮状态 |
|---|---|
| 只实现 B11 / B12 / B13 / B14，不改 S0—S10 既有业务含义 | ✅ 未越界；未实现 F1—F4 新功能；S0—S10 业务文件未改动 |
| 不修改 `db/schema.sql`、不新增表、不执行 DDL | ✅ 18 张表不变，`synchronize=false` 未触碰 |
| 不清表、不重导、不删除、不修改既有业务数据 | ✅ 未执行任何数据库写操作（本会话全部接口为只读） |
| 所有业务 HTTP 路径 `/api/v1` + 复数资源名 | ✅ `quality-analyses/*`、`material-requirement-calculations` |
| 所有写入经过 NestJS/JWT/RBAC/事务/审计 | ✅ 本会话无业务写入入口（SPC/MRP 为只读计算，不写审计，与 B8 驾驶舱口径一致）；前端无任何新增写入通道（报工/SN/设备仍走既有 S5/S6/S10 接口） |
| 前端不直连 MySQL / FastAPI 8000，不持有 AI Key | ✅ 未新增任何直连；Service Worker 明确不缓存 `/api/` |
| 不伪造库存、采购在途、设备事件、质量数据 | ✅ MRP 三个受限字段恒 null；PWA 不生成任何演示数据 |
| 演示数据保留 `dataSource` / `dataLabel` 诚实标识 | ✅ SPC/MRP 全部响应携带；前端每张卡片渲染 `DataSourceTag` |
| 不改变 S10 已确认认证/审计/事务/权限边界 | ✅ 未改 `common/auth/**`、未改权限矩阵（B11/B12 行在 S4 已按契约预置） |
| 不启用未批准的 Q8 ERP/MQTT/PLC 集成规则 | ✅ B14 路由不注册（见 §6） |
| 不新增 Redis/Socket.io/队列等基础设施 | ✅ PWA 仅用浏览器原生 Cache API / sessionStorage / BarcodeDetector（渐进增强） |
| 不越界实现 S12 联调终验 | ✅ 未做真实联调、未宣布验收 |

---

## 1. 实际实现范围与文件清单

### 1.1 后端 · 新增（B11 / B12）

| 文件 | 作用 |
|---|---|
| `backend/src/modules/quality-analyses/quality-analyses.module.ts` | B11 模块装配（只读，无实体注册） |
| `backend/src/modules/quality-analyses/quality-analyses.controller.ts` | 三个 GET 接口；`AuthGuard + RolesGuard + @RequireRoles('admin','manager')` |
| `backend/src/modules/quality-analyses/quality-analyses.service.ts` | Pareto / 趋势 / 良品率计算；严格半开区间；REPEATABLE READ 一致性读 |
| `backend/src/modules/quality-analyses/dto/quality-analysis-query.dto.ts` | 查询 DTO（`startDate/endDate` 必填，`prodLine`、`stepName` 可选；未知字段由全局管道拒绝） |
| `backend/src/modules/quality-analyses/pareto.util.ts` | Pareto 纯计算：qty 降序 + defectType 升序显式全序、share/cumulativeShare、总量 0 时空数组 |
| `backend/src/modules/material-requirements/material-requirements.module.ts` | B12 模块装配（只读） |
| `backend/src/modules/material-requirements/material-requirements.controller.ts` | `POST /material-requirement-calculations`；admin/manager |
| `backend/src/modules/material-requirements/material-requirements.service.ts` | 订单校验、BOM 校验（30005）、BigInt 精确毛需求聚合、inboundQty、limitations |
| `backend/src/modules/material-requirements/dto/material-requirement-calculation.dto.ts` | 请求 DTO：`orderIds` 非空、`@ArrayMaxSize(100)`、十进制字符串 |
| `backend/src/modules/material-requirements/decimal.util.ts` | 精确十进制（缩放整数 + BigInt），`grossRequiredQty` 输出十进制字符串 |

### 1.2 后端 · 新增测试

| 文件 | 例数 |
|---|---|
| `backend/src/modules/quality-analyses/pareto.util.spec.ts` | 6 |
| `backend/src/modules/quality-analyses/quality-analyses.service.spec.ts` | 10 |
| `backend/src/modules/material-requirements/decimal.util.spec.ts` | 4 |
| `backend/src/modules/material-requirements/material-requirements.service.spec.ts` | 13 |
| `backend/test/s11-permissions.e2e-spec.ts` | 17 |

### 1.3 后端 · 修改（2 个文件，均为装配/测试登记）

- `backend/src/app.module.ts`：注册 `QualityAnalysesModule` / `MaterialRequirementsModule`（含注释说明）。
- `backend/test/route-registration.e2e-spec.ts`：S11 五个路由从「未启用 404」清单移入「已注册 401」清单；**B14 integrations 两条保持 404/30001 断言**。

### 1.4 前端 · 新增

| 文件 | 作用 |
|---|---|
| `frontend/src/types/quality-analysis.ts`、`frontend/src/types/material-requirement.ts` | 契约类型（含 `isTrueFpy: false` 字面量、三个受限 null 字段） |
| `frontend/src/services/quality-analyses.ts`、`frontend/src/services/material-requirements.ts` | 经统一 http 客户端的服务层 |
| `frontend/src/services/s11-services.spec.ts` | 服务层回归（5 例） |
| `frontend/src/utils/spc-charts.ts`（+ spec，7 例） | Pareto / 趋势 SVG 几何纯函数（null 断线） |
| `frontend/src/utils/scan-guard.ts`（+ spec，6 例） | 扫码内容安全守卫（拒 SQL / URL / 连接串） |
| `frontend/src/utils/offline-queue.ts`（+ spec，16 例） | 离线待提交队列纯逻辑（**v2：按用户隔离存储键 + pending/unknown 双状态**） |
| `frontend/src/utils/report-submit-outcome.ts`（+ spec，3 例） | 提交失败结局判定（结果不明 vs 明确拒绝，纯函数） |
| `frontend/src/utils/spc-query.ts`（+ spec，3 例） | SPC 三接口参数分别构造（stepName 只进 trends） |
| `frontend/src/utils/pending-item-actions.ts`（+ spec，9 例） | 待提交记录操作集决策（提交/编辑/移除/核查后移除，纯函数） |
| `frontend/src/views/quality-analyses/QualityAnalysesView.vue` | SPC 页：Pareto 图 + 趋势图 + 良品率 + 口径限制 |
| `frontend/src/views/mrp/MrpView.vue` | MRP-lite 页：订单选择 + 毛需求 + 限制说明 |
| `frontend/src/views/mobile/MobileWorkbenchView.vue` | B13 移动工作台（`/mobile`） |
| `frontend/public/manifest.webmanifest` | PWA 清单（`start_url:/mobile`，standalone，三枚图标） |
| `frontend/public/sw.js` | Service Worker：只缓存外壳，不缓存 `/api/` |
| `frontend/public/icons/icon-192.png`、`icon-512.png`、`icon-maskable-512.png` | 图标（Node zlib 手写 PNG 编码生成，无新依赖） |
| `frontend/scripts/generate-pwa-icons.mjs` | 图标生成脚本 |

### 1.5 前端 · 修改（4 个文件）

- `frontend/index.html`：manifest / theme-color / apple-touch-icon / mobile-web-app 元信息。
- `frontend/src/main.ts`：仅生产构建注册 `/sw.js`（开发期不拦截 HMR；注册失败静默降级为在线应用）。
- `frontend/src/router/routes.ts`：新增 `/mobile` 独立全屏路由（`requiresAuth: true`，不套桌面布局）。
- `frontend/src/config/modules.ts`：B11 / B12 置 `implemented: true` 并登记真实组件（`modules.spec.ts` 派生断言随之转绿）。

**未修改**：`db/schema.sql`、`docs/api-contract.md`、`docs/需求规格说明书_定稿.md`、S0—S10 业务代码、`ai-service/`。

---

## 2. API ↔ 契约 ↔ 权限对应表

> 权限列对应契约 §5.2（第 21、22 行：B11 / B12 均为 admin / manager，operator 拒绝）。
> 「实现状态」标注本轮可访问性；全部为**只读**接口，无写入口。

| 方法与路径 | 契约 | 允许角色 | 实现状态 |
|---|---|---|---|
| `GET /api/v1/quality-analyses/paretos` | §6.5 | admin / manager | ✅ 只读；`defect.qty` 聚合 |
| `GET /api/v1/quality-analyses/trends` | §6.5 | admin / manager | ✅ 只读；报工数量口径 |
| `GET /api/v1/quality-analyses/good-rates` | §6.5 | admin / manager | ✅ 只读；`isTrueFpy:false` |
| `POST /api/v1/material-requirement-calculations` | §6.10 | admin / manager | ✅ 只读计算；200（非 201，不创建持久资源） |
| `POST /api/v1/integrations/erp-orders` | §6.11 | **未启用** | ⛔ 路由不注册 → 404 / 30001 |
| `POST /api/v1/integrations/device-events` | §6.11 | **未启用** | ⛔ 路由不注册 → 404 / 30001 |

B13 移动端**不新增任何接口**，全部复用：`GET /work-orders`、`GET /work-orders/{id}/tasks`、`POST /reports`、`GET /sn-traces/{sn}`、`POST /devices/{code}/state-transitions`（当前一律 30006，Q3 未批准，如实展示）。

---

## 3. B11 统计口径与限制（与契约 §6.5 逐条对齐）

1. **Pareto 数据源**：`defect.qty`（SQL 侧 `SUM(d.qty)`），日期窗口按 `qc_record.checked_at`（与 S9 defectQty 分析同一口径，不良明细与检验同事务产生）。
2. **排序**：`qty` 降序、`defectType` 升序——`pareto.util.ts` 用**显式全序比较**（不依赖引擎 sort 稳定性），结果可重现。
3. **share / cumulativeShare**：百分比口径（`96` 表示 96%），保留 2 位小数（与 B8 `Number((x*100).toFixed(2))` 一致）；**总量为 0 时返回空数组，不制造 0% 条目**。
4. **趋势口径**：`report.good_qty / bad_qty`（报工数量）。SQL 只读 `report` 与 `work_task`，**不含 `ng_qty`**（单测断言 SQL 不出现该列）；`badRate = badQty/(goodQty+badQty)×100`，某日报工总量为 0 时 `badRate: null`。
5. **指标命名**：趋势恒为 `metric:"reportBadRate"`，良品率恒为 `metric:"reportGoodRate"` 且 `isTrueFpy:false`——前端页面以 `el-tag` 显式渲染该字段并附说明，**不把报工良品率冒充真实 FPY**。
6. **产线归属**：只能由 `work_task.prod_line` 推断。
   - 指定产线（非「未分配」）→ 只纳入 `t.prod_line = ?` 的记录；
   - `prodLine=未分配` → 纳入 `prod_line IS NULL/''/'未分配'`（无任务关联或未分配产线的记录）；
   - 无任务关联的检验（`task_id` 为空）**不能**推断产线，指定产线时不纳入（Pareto 用 `LEFT JOIN work_task`，指定产线条件天然排除）。
7. **日期区间**：严格半开区间 `[startDate 00:00:00, endDate+1 00:00:00)`（Asia/Shanghai 服务端口径，与 S6/S7/S10 一致）；`isValidDateOnly` 拒绝 `2026-02-31` 这类不存在的日历日，`startDate > endDate` → 10001。
8. **空数据诚实性**：Pareto 无缺陷 → `items:[]` + `totalDefectQty:0` + `calculationStatus:"no_data"`；趋势/良品率无报工 → `points:[]` / `value:null` + `no_data`——均**不以 0 冒充未知**，前端渲染对应的空态文案。
9. **统一约定**：统一包体（`{code,message,data}`）、错误码（10001/20001/20004）、`X-Request-Id`、演示数据标识（`dataSource:"demo"` / `dataLabel:"演示数据"`）、`snapshotAt` 截止时刻。
10. **限制说明**（页面常驻展示）：同件多缺陷体系不推断；趋势/良品率不混入质检数量；不是真实 FPY；产线只能由任务推断。

---

## 4. B12 毛需求限制（与契约 §6.10 逐条对齐）

1. **参数**：`orderIds` 非空（空数组 → 10001）、最多 100 个（`@ArrayMaxSize(100)` + 服务层双检）、**重复项 → 10001**（服务层 `Set` 判重；不做静默去重，避免同一订单被重复计料）、每项须为 BIGINT 十进制字符串（`isValidDecimalId`，含容量上限）。
2. **订单真实性**：`SELECT ... WHERE id IN (...)` 全量命中才算存在；任一不存在 → **30001**（与 S6「关联工单不存在」口径一致），不返回部分结果。
3. **计算式**：仅 `order.qty × bom.qty`；同一物料跨订单**按数量累加**（BigInt 精确运算，见 `decimal.util.ts`）。
4. **只返回平面 BOM 毛需求**：不做多层递归（`bom.level` 不是父子边，契约 §6.6 已冻结该解读）、不含损耗/替代料/在产扣减。
5. **`grossRequiredQty` 为十进制字符串**（2 位小数，如 `"200.00"`）：BigInt 缩放整数避免 JS number 在极端值（INT×DECIMAL 上限）下丢精度；单测以 `2147483647 × 99999999.99 = 214748364678525163.53` 锁死精度。
6. **三个受限字段恒 null**：`availableQty / shortageQty / purchaseSuggestionQty`——现有表无出库、占用、调整、采购在途流水；服务端返回字面量 `null`，前端显示「不可用」并附限制说明，**不把 null 变成 0、不自行相减推导缺料**。
7. **`inboundQty`（信息字段）**：`material_batch.qty` 合计，仅作参考；页面与 limitations 双重声明「**不等于可用库存**」，不得据此推导缺料（任务书 B12 要求 11）。
8. **缺 BOM → 30005**：产品无 BOM 明细时整体请求失败（`MISSING_PREREQUISITE`），**不当作「无需物料」跳过**；部分订单缺 BOM 同样整体 30005，不静默漏算物料。
9. **limitations**：响应携带 4 条明确限制（不做多层递归 / 不能算净缺口与采购量 / inboundQty 非可用库存 / 不含损耗替代料、不持久化采购单）；页面常驻展示。
10. **不持久化采购单、无采购写入入口**：本接口为只读快照，不写业务数据、不写审计（与 B8/B11 只读口径一致）；读取走 REPEATABLE READ 事务（单测断言三次查询在同一 executor 且无任何 INSERT/UPDATE/DELETE）。

---

## 5. B13 离线与扫码行为

1. **入口**：`/mobile` 独立全屏路由（`requiresAuth`，不套桌面布局）；manifest `start_url:/mobile`、standalone、portrait；`index.html` 增加 theme-color / apple-touch-icon / mobile-web-app 元信息；生产构建注册 `public/sw.js`。
2. **Service Worker 边界**：只预缓存外壳（`/`、`/mobile`、manifest、图标、favicon）；**`/api/` 一律放行且不缓存**（业务数据与令牌边界）；只拦截 GET；写请求（POST/PATCH/DELETE）不拦截、不重发；导航请求 network-first，离线回退缓存外壳并触发 `504` 文案。测试未覆盖真实 Service Worker 运行时（见 §10）。
3. **扫码流程**（全部复用既有 API，无新增业务规则、无额外权限）：
   - 扫码/输入工单编号 → `validateScanInput` 安全校验 → `GET /work-orders?keyword=...` → 选择工单 → `GET /work-orders/{id}/tasks` → 选择任务 → 输入良/不良数量 → **用户点击确认** → `POST /reports`；
   - 扫码 SN → `GET /sn-traces/{sn}`（展示单快照 + coverage/limitations）；
   - 设备编号 → `GET /devices/{code}` → 目标状态下拉 → `POST /devices/{code}/state-transitions`（Q3 未批准，服务端一律 30006，页面如实展示拒绝原因，**不伪造本地状态变更**）。
4. **扫码内容安全**：只允许编号字符集（字母/数字/点/下划线/连字符，≤64 字符）；SQL 元字符、引号、URL 协议、路径分隔符、空白、`%` 一律拒绝并给出原因（`scan-guard.ts` + 6 例单测，含 `DROP TABLE` / `UNION SELECT password_hash` / `mysql://root:...` 注入样本）。**不把扫码内容当作 SQL、连接串或任意 URL。**
5. **离线待提交（v2，按用户隔离）**：断网时 `POST /reports` 不发送，输入转为待提交记录写入 **sessionStorage**（键 `mes.mobile.pendingReports.v2.<userId>`，记录带 `ownerId`），UI 明确标记「**未提交**」；记录只含业务输入与归属用户 ID，**不含令牌**；解析损坏数据按空队列处理不抛错；入队同时更新响应式队列（复审 P2 #3）。
6. **恢复网络**：待提交 Tab 显示队列与「确认提交」按钮，**必须由用户逐条点击提交**；模块内**无定时器、无重试、无后台补发**（纯逻辑单测锁死该性质）；`useSubmitGuard` 同步加锁防重复点击；提交成功才出队。**提交前核对 `ownerId` 与当前登录用户一致**，不一致拒绝并移出列表（复审 P2 #1）。
7. **账号边界（复审 P2 #1）**：队列按用户隔离——账号 B 登录后只看得到、也只可提交自己的记录；**主动退出**先清除本人队列存储再清会话；**401 / 切换账号**由身份 watcher 立即按新身份重载（无身份时展示为空，同账号同标签页重新登录后本人队列恢复可见）；`filterOwnedReports` 兜底过滤任何跨账号残留。
8. **「未提交」与「结果未知」双状态（复审 P2 #2）+ 「被拒绝」可修正（复审 P2 #5）**：
   - `pending`（未发送，仅离线入队）→ 可经本人确认后补交、可修改数量、可移除；
   - `pending` + `lastRejection`（确认提交被**明确拒绝**：400/409/403/30003/30006 等）→
     展示拒绝原因、默认展开数量编辑器（「保存修改」后重新确认提交），并提供「移除」出口——
     不存在「只能反复发送同一无效请求」的死循环；`unknown`（**已发送但结果不明**：网络错误 /
     超时 / 5xx / 响应不可解析，`classifySubmitFailure` 判定）→ **不提供普通补交入口**；表单数量同步清空
     防止重复发送；页面要求人工核查（如到报工列表核对数量），由用户显式「人工核查后移除」；
   - 新提交（非队列记录）明确被拒（4xx/业务错误）→ **不入队**，保留表单数值供修正后直接再次提交；
   - 全程**不引入未经批准的持久幂等方案**（Q9 未批准）。
9. **UI 状态**：401 由既有 http 层清理内存令牌并跳登录（mobile 页同样生效）；403/30006/30001 经 `showApiError` 明确提示；网络状态徽标（在线/离线）实时反映 `navigator.onLine`。
9. **摄像头扫码**：仅在浏览器提供 `BarcodeDetector` + `getUserMedia` 时启用（渐进增强，无新依赖）；不可用时提示手动输入。未在真实设备/浏览器验证（见 §10）。
10. **适配**：`max-width:560px` 单列布局、≥44px 触控目标、`viewport-fit=cover`；桌面端既有页面与路由**未受影响**（`/mobile` 为新增路由）。

---

## 6. B14 未启用原因及 404/30001 证据

**未启用原因**（契约 §10.2 Q8，用户未批准）：
- 无 ERP 外部单号存储、无设备 `eventId` 唯一键 / 幂等存储、无集成账号表；
- MQTT/PLC 明确不做；集成身份、编号映射、乱序事件与持久幂等策略均未定义。

**本轮行为**：`POST /api/v1/integrations/erp-orders` 与 `POST /api/v1/integrations/device-events` **不注册路由**，任何角色（含匿名）访问都得到 NestJS 的统一 404：
- HTTP `404` + `{"code":30001,"message":"资源不存在"}`（`AllExceptionsFilter` 对无匹配路由归一）；
- 因此**不存在**匿名设备上传通道、不使用浏览器 JWT 代替集成身份、不写订单/设备/审计数据；
- 不新增集成账号表、外部编号字段、`eventId` 唯一键或幂等存储；
- 前端无任何「已接入 ERP/MQTT/PLC」宣称。

**证据（测试断言，本轮实际执行通过）**：
- `test/route-registration.e2e-spec.ts`：两条 integrations 路径断言 `status=404` 且 `code=30001`（匿名路径，normal startup fail-closed）；
- `test/s11-permissions.e2e-spec.ts`：admin / manager / operator 三个身份替身分别对两条路径发送完整业务包体，均断言 `404/30001`（含 `source`、`externalOrderCode`、`eventId` 等候选字段——路由不存在即拒绝，不进入任何处理逻辑）。

---

## 7. 权限、审计、数据来源与安全边界

1. **权限**：B11 / B12 走既有 `AuthGuard + RolesGuard + @RequireRoles('admin','manager')`；权限矩阵（`common/auth/permission-matrix.ts` 与前端 `config/permissions.ts`）中 `quality-analyses:read` 与 `material-requirement-calculations:create` 两行在 S4 已按契约 §5.2 预置，**本轮未改动矩阵**。三角色 e2e 实证：admin/manager 200，operator 403/20004。
2. **审计**：本会话无业务写入，故无审计写入（与 B8 驾驶舱、B11 只读分析一致；任务书「所有写入必须审计」对零写入接口无触发点）。
3. **数据来源**：SPC / MRP 响应恒带 `dataSource:"demo"` / `dataLabel:"演示数据"`（`DEMO_SOURCE_META`）；前端每张卡片渲染 `DataSourceTag`；MRP 的 `inboundQty` 与 limitations 明示「不等于可用库存」。
4. **一致性读**：SPC / MRP 的多表读取走 REPEATABLE READ 事务执行器（与 S7 修复后同一模式，失败直接向上传播，不静默降级重跑）。
5. **日志脱敏**：本会话未新增任何 `logger.error/warn` 调用，未扩大脱敏面；MRP/S 错误信息只含订单 ID、产品编号等业务标识，无凭据。
6. **前端边界**：不直连 MySQL / FastAPI；不持有 AI Key；Service Worker 不缓存 `/api/`；待提交队列不存令牌；扫码输入经安全守卫。
7. **18 张表**：未新增实体、未改 `schema.sql`、未执行 DDL；`route-registration` 的实体清单守卫（15 实体 ↔ 文件数）未受影响。

---

## 8. 测试记录（每条命令与真实结果）

> 环境：Windows + Git Bash；Node（managed 22.22.2）；**临时副本** `D:\tmp-s11-verify`（robocopy 排除 node_modules/dist + junction 挂载原 node_modules，跑完已删除）。
> 全部命令为**执行方自测**；替身/身份替身测试性质见 §10。

| # | 类别 | 命令 | 退出码 | 真实结果 |
|---|---|---|---|---|
| 1 | 后端单元测试 | `npx vitest run`（backend） | 0 | **45 文件 / 411 例全部通过**（S11 新增 33 例单测：pareto.util 6 + quality-analyses.service 10 + decimal.util 4 + material-requirements.service 13） |
| 2 | 后端无数据库 HTTP e2e | `npm run test:e2e` | 0 | **5 文件 / 60 例全部通过**（含 `s11-permissions` 17 例与 `route-registration` 7 例） |
| 3 | 后端 lint | `npx oxlint src/ test/` | 0 | **0 error / 4 warning**（warning 均在既有文件：`data-queries.query.spec.ts` 1、`s6-s7-real-integration.test.mjs` 3，非本轮新增） |
| 4 | 后端完整 TS 检查 | `npx tsc --noEmit -p tsconfig.json` | 0 | **0 error** |
| 5 | 后端构建 | `npx tsc -p tsconfig.build.json --outDir <临时目录>` | 0 | **0 error**（`nest build` 的 `deleteOutDir` 沙箱拦截问题与 S10 记载相同，与代码无关；已验证 tsc 构建路径后可删除临时目录） |
| 6 | 前端测试 | `npx vitest run`（frontend） | 0 | **31 文件 / 307 例全部通过**（S11 相关 49 例：s11-services 5 + spc-charts 7 + scan-guard 6 + offline-queue 16 + report-submit-outcome 3 + spc-query 3 + pending-item-actions 9） |
| 7 | 前端 lint | `npx oxlint src/` | 0 | **0 error / 1 warning**（既有 `router/redirect.ts` 控制字符正则，非本轮新增） |
| 8 | 前端类型检查 | `npm run typecheck`（`vue-tsc -b`，构建流水线内） | 0 | **0 error** |
| 9 | 前端构建 | `npm run build` | 0 | **成功**；`dist/` 含 `manifest.webmanifest`、`sw.js`、三枚 PNG 图标（仅 chunk >500kB 提示，非错误） |
| 10 | 真实 MySQL e2e | `npm run test:e2e:db` | — | **未执行**：环境未注入 `DB_PASSWORD`，两个 db-e2e 文件的守卫**主动抛错**（`[S5 e2e 无法执行] DB_PASSWORD 不可用`），37 例 skipped、2 文件 failed（守卫失败，非业务失败）。**不得**把该退出当作真实数据库通过 |

### §九 测试要求覆盖对照

| # | 要求 | 覆盖文件 | 类型 |
|---|---|---|---|
| 1 | Pareto 排序、累计占比、空数据 | `quality-analyses.service.spec.ts`（10 例）+ `pareto.util.spec.ts`（6 例） | 单元（替身数据源） |
| 2 | 趋势按报工数量计算（不混 ng_qty） | `quality-analyses.service.spec.ts`（SQL 不含 ng_qty 断言） | 单元（替身） |
| 3 | 良品率明确 `isTrueFpy:false` | 同上 + `s11-services.spec.ts`（前端类型层字面量） | 单元 |
| 4 | 产线过滤与未分配记录 | `quality-analyses.service.spec.ts`（`SMT-2线` / `未分配` 两组 SQL 断言） | 单元（替身） |
| 5 | MRP 毛需求计算 | `material-requirements.service.spec.ts`（13 例，含 `146.30` 精确累加） | 单元（替身） |
| 6 | 订单去重、上限 100、缺 BOM 30005 | 同上 + `s11-permissions.e2e-spec.ts`（HTTP 层 10001/30005/30001） | 单元 + HTTP e2e |
| 7 | 三个受限字段保持 null | `material-requirements.service.spec.ts`（`toEqual` 全字段含 null）+ `s11-services.spec.ts` | 单元 |
| 8 | B14 路由 404/30001 | `route-registration.e2e-spec.ts` + `s11-permissions.e2e-spec.ts`（三角色） | HTTP e2e |
| 9 | 三角色权限与越权拒绝 | `s11-permissions.e2e-spec.ts`（17 例：admin/manager 200，operator 403/20004） | HTTP e2e（身份替身 + mock 数据源） |
| 10 | 参数类型/长度/未知字段/重复输入 | `s11-permissions.e2e-spec.ts`（缺日期、`2026-13-01`、`2026-02-31`、逆序、未知字段、超长 stepName、orderIds 非数组/空/101 项/重复/非数字/超 BIGINT） | HTTP e2e |
| 11 | 前端 Pareto/趋势/良品率渲染 | `spc-charts.spec.ts`（7 例）+ `spc-query.spec.ts`（3 例）+ `s11-services.spec.ts` | 前端逻辑（node） |
| 12 | MRP 结果及限制说明 | `s11-services.spec.ts`（items/limitations/三 null 字段断言） | 前端逻辑 |
| 13 | PWA 手机布局与扫码流程 | `scan-guard.spec.ts`（6 例）+ `offline-queue.spec.ts`（16 例）+ `/mobile` 路由与 manifest 产物（构建断言） | 前端逻辑 + 构建产物检查 |
| 14 | 离线待提交状态 | `offline-queue.spec.ts`（pending 标记、按用户隔离键、无 token 字段） | 前端逻辑 |
| 15 | 恢复网络后用户确认提交 | `offline-queue.spec.ts`（按 id 出队；无定时器/自动路径） | 前端逻辑 |
| 16 | 不自动重试追加写入 | `offline-queue.spec.ts`（模块无重试导出）+ `sw.js` 不拦截非 GET（人工核对）+ `report-submit-outcome.spec.ts`（3 例，结果不明禁补交） | 前端逻辑 |
| 17 | 拒绝后不死循环（复审 P2 #5） | `pending-item-actions.spec.ts`（9 例：三态操作集 + 入队→拒绝→编辑/移除出口→改后重试端到端） | 前端逻辑 |
| 17 | 401/403、提交失败、重复点击 | `s11-permissions.e2e-spec.ts`（403/20004）+ 既有 `useSubmitGuard` 在 mobile 页提交路径使用 + http 层 401 既有回归 | 混合 |

---

## 9. 失败、跳过、连接拒绝与环境限制（如实记录）

1. **真实 MySQL 数据库 e2e**：未执行。环境未注入 `DB_PASSWORD`（前置即拒绝，退出码非 0 的守卫失败），未获授权隔离库。S11 未新增任何 db-e2e 文件。
2. **真实 JWT HTTP 登录链路**：未执行（与 S10 相同缺口：`POST /sessions` → 持令牌访问 → 三角色，未在真实库上跑通）。S11 权限结论仅由**身份替身 + mock 数据源**支撑。
3. **真实浏览器验证**：未执行（无 Chrome/Edge 自动化）。SPC/MRP 页面与 `/mobile` 的 DOM、触控、摄像头、Service Worker 安装/离线回退**均未在真实浏览器验证**；前端测试为 node 环境纯逻辑单测。
4. **构建环境注**：`nest build` 因 `deleteOutDir:true` 触发沙箱批量删除保护（与 S10 记载一致，与代码无关）；改用 `tsc -p tsconfig.build.json --outDir <临时目录>` 验证 0 error。
5. **迭代期运行位置说明**：开发迭代（改错阶段）曾在原目录直接运行 vitest/e2e 以快速定位问题；**最终验证全部在临时副本执行**（§8 表格）。原目录仅留下源码与测试文件改动，无 dist / 缓存产物。
6. **无失败未修复项**：§8 十条命令全部退出码 0；无 skipped 的业务断言；无已知功能缺陷。
7. **真实 MySQL e2e 的执行尝试（2026-10-15）**：按用户指令尝试运行 `npm run test:e2e:db`。结果：**守卫按设计拒绝执行**（`DB_PASSWORD` 解析为空字符串——`backend/.env` 中该行为空占位、本机会话环境未注入、历史会话无口令记录），2 个文件 37 例全部 skipped、 guard 主动抛错，退出码 1。已另行确认：MySQL `127.0.0.1:3306` 端口可达；本套 db-e2e（`orders.db-e2e` / `bom-confirm-race.db-e2e`）**不需要 `JWT_SECRET`**（两个 spec 均无认证链路，已核对）。真实执行仍**待用户在本机 pwsh 7 同一会话注入口令后运行**；在获得输出前，S5 订单 e2e 与 S10 P2 真实并发验证均维持「未执行」状态，不以任何形式视为通过。

---

## 10. 未验证项与回归风险

### 10.1 未验证项（不得声称已验收）

1. SPC / MRP 的全部 SQL **未在真实 MySQL 执行**（半开区间、聚合、`DATE_FORMAT`、`IN (...)`、BigInt 精度均只有替身断言）。
2. 真实 JWT 三角色访问 SPC/MRP（401/403 路径只有替身证据）。
3. `/mobile` 真实设备：摄像头扫码、PWA 安装、离线导航回退、断网报工入队-恢复提交闭环**未在真实浏览器/手机验证**。
4. 真实并发：SPC/MRP 为只读，无写入竞争；但 MRP 多订单 `IN` 查询在大数据量下的表现未测。
5. `ai-service` 未触及（S11 不含 AI 变更），Python 回归未运行（与 S10 同样理由）。

### 10.2 回归风险与后续注意事项

1. **`route-registration.e2e-spec.ts` 是 B14 的回归护栏**：若后续会话注册 integrations 路由，该文件会立即失败——这是预期护栏，不是缺陷；启用集成**必须**先获 Q8 批准。
2. **S11 五个路由现在断言 401**（fail-closed）：将来若改动认证装配导致其可达，该测试会失败——同样是预期护栏。
3. **`MaxLength` 不能用于数组**（本轮实际踩坑并修复）：class-validator 的 `@MaxLength` 对数组恒 false；数组长度上限必须用 `@ArrayMaxSize`。后续 DTO 注意。
4. **mock 数据源的 SQL 特征匹配顺序敏感**：`s11-permissions.e2e-spec.ts` 的替身按 `DATE_FORMAT` / `COUNT(*) AS report_count` 等独有特征区分 trends 与 good-rates（二者 SQL 都含 `COALESCE(SUM(r.good_qty),0)`）；后续若改动这两个 SQL 的形状，需同步替身。
5. **MRP 重复 orderIds 选择拒绝而非静默去重**：这是保守口径（避免重复计料）；若产品要求改为静默去重，需同步契约与单测。
6. **移动端待提交队列用 sessionStorage**：刷新可恢复、关标签页即清（有意为之，不在本地长期留存业务输入）；若要跨会话恢复需另行评估存储边界。
7. **`BarcodeDetector` 为渐进增强**：浏览器不支持时仅手动输入，不影响功能正确性。
8. **待提交队列存储键版本为 v2**：v1 共享键的历史数据不会被新键读取（按设计隔离）；若未来调整键结构，需再次升版并处理迁移。
9. **「结果未知」依赖错误类型判定**：若后端未来把「已应用但响应失败」也归入 4xx 业务码，判定会把本应核查的记录误判为明确拒绝——后端错误码语义变化时必须同步复核 `report-submit-outcome.ts`。
10. **`lastRejection` 是展示元数据**：清除仅发生在「修改数量」与「移除/成功提交」时；若服务端拒绝原因后续变化（如 30006 审批通过），旧记录上的历史拒绝文案不会自动刷新，重新提交后会覆盖为新结果。

---

## 11. S11 复审 P2 缺陷修复记录（2026-10-14 · 第二轮）

> 复审第一轮结论：**暂不通过**，4 项 P2 均集中在前端集成与移动报工；原项目业务文件与既有数据库未修改。
> 以下为逐项修复与复测证据；**仍待独立复审**。

### 11.1 P2 #1 待提交队列跨账号残留（可能造成报工归属错误）

| 项 | 内容 |
|---|---|
| 原缺陷 | 队列使用共享存储键 `mes.mobile.pendingReports.v1`、无用户归属，退出不清除；账号 B 在同一标签页登录后可提交账号 A 的输入，服务端却按 B 的 JWT 记录操作员 |
| 修复 | ① 存储键改为 `mes.mobile.pendingReports.v2.<userId>`（`pendingStorageKeyFor`），记录新增 `ownerId`；② 提交前 `isOwnedBy` 核对归属，不一致拒绝提交并移出列表；③ `filterOwnedReports` 加载时兜底过滤跨账号/无归属记录（含历史共享键数据）；④ 身份 watcher：登录/401/切换账号立即按新身份重载；主动退出先 `clearPendingReports` 本人队列再清会话 |
| 文件 | `frontend/src/utils/offline-queue.ts`（重写 v2）、`frontend/src/views/mobile/MobileWorkbenchView.vue` |
| 测试 | `offline-queue.spec.ts` 16 例：跨账号键隔离、`isOwnedBy`/`filterOwnedReports`（含 legacy 无 ownerId 数据）、anonymous 占位键、退出清空 |
| 效果边界 | 纯逻辑 + 类型层验证；真实双账号浏览器行为未验证（见 §10） |

### 11.2 P2 #2 已发送但结果不明的报工被标为「未提交」

| 项 | 内容 |
|---|---|
| 原缺陷 | 服务端可能已提交但响应超时/丢失时，统一按「未提交」入队且不清表单，用户可再次发送同一笔报工 |
| 修复 | 新增 `PendingReportStatus = 'pending' \| 'unknown'`：`pending`=从未发送（仅离线入队）；`unknown`=已发送但结果不明。新增 `report-submit-outcome.ts` 纯函数按错误类型判定：network/timeout/server/dependency/malformed/unknown → 结果不明；business/4xx/401/已取消 → 明确拒绝（不入队，保留表单供修正）。`unknown` 记录**无普通补交入口**，表单数量同步清空；页面要求人工核查后由用户显式「人工核查后移除」。确认提交失败时同样转 `unknown`。**未引入任何持久幂等方案**（Q9 未批准） |
| 文件 | `frontend/src/utils/offline-queue.ts`、`frontend/src/utils/report-submit-outcome.ts`（新）、`frontend/src/views/mobile/MobileWorkbenchView.vue` |
| 测试 | `report-submit-outcome.spec.ts` 3 例（两种结局全类型覆盖）+ `offline-queue.spec.ts`（unknown 入队/转换/分组/不进可补交组） |
| 效果边界 | 判定为保守启发式：极端情况下 5xx 前已写入会被正确标为 unknown；但「明确拒绝」集合之外的未知异常按 unknown 处理（宁可多核查，不重复发送） |

### 11.3 P2 #3 离线入队后页面仍显示没有待提交记录

| 项 | 内容 |
|---|---|
| 原缺陷 | 两处 `enqueuePendingReport()` 只写存储不更新 `pending.value`，列表仅初始化时读取；存储已有 1 条而页面状态为 0，恢复网络后无法在当前列表确认提交 |
| 修复 | 统一入口 `enqueueOwned(report)`：`pending.value = enqueuePendingReport(store, queueKey.value, report)`，存储与响应式队列同步更新；离线入队、结果不明入队、确认提交出队、移除全部走该模式 |
| 文件 | `frontend/src/views/mobile/MobileWorkbenchView.vue` |
| 测试 | `offline-queue.spec.ts` 入队/出队往返断言（util 层）；视图层响应式更新依赖 vue-tsc 与构建验证（无 jsdom 组件测试，见 §10） |

### 11.4 P2 #4 填写工序筛选后 Pareto 与良品率查询报错

| 项 | 内容 |
|---|---|
| 原缺陷 | 三个请求共用带 `stepName` 的参数对象，但该字段只允许用于 trends；独立 HTTP 探针确认 trends 200、paretos/good-rates 均 400/10001（服务端 forbidNonWhitelisted 拒绝未知字段） |
| 修复 | 参数构造收敛为纯函数 `buildSpcQueries(filters)`：`stepName` 仅在有值时进入 `trend`；`pareto`/`goodRate` 只含 `startDate/endDate/prodLine`（「全部」→ 不携带） |
| 文件 | `frontend/src/utils/spc-query.ts`（新）、`frontend/src/views/quality-analyses/QualityAnalysesView.vue` |
| 测试 | `spc-query.spec.ts` 3 例：无筛选时三接口均无 `stepName` 键；填写后仅 trends 携带；指定产线三接口一致 |

### 11.5 第二轮复测（临时副本 `D:\tmp-s11-verify2`，跑完已删）

| 类别 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 后端单元 | `npx vitest run` | 0 | 45 文件 / 411 例通过（后端未改动，复跑确认无回归） |
| 后端无库 e2e | `npm run test:e2e` | 0 | 5 文件 / 60 例通过 |
| 后端 lint | `npx oxlint src/ test/` | 0 | 0 error / 4 warning（既有文件） |
| 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | 0 | 0 error |
| 后端构建 | `npx tsc -p tsconfig.build.json --outDir <临时目录>` | 0 | 0 error |
| 前端测试 | `npx vitest run` | 0 | **30 文件 / 298 例通过**（较第一轮 +2 文件 +15 例） |
| 前端 lint | `npx oxlint src/` | 0 | 0 error / 1 warning（既有 `router/redirect.ts`） |
| 前端类型检查 | `vue-tsc -b`（构建流水线内） | 0 | 0 error |
| 前端构建 | `npm run build` | 0 | 成功，PWA 产物齐全 |

### 11.6 P2 #5 明确拒绝的待提交记录无法修正或移除（重复提交死循环）· 2026-10-15 修复

| 项 | 内容 |
|---|---|
| 原缺陷 | 离线入队后「确认提交」被明确拒绝（400/409/403/30006）：记录保持 pending，但界面只有「确认提交」按钮——没有编辑数量、编辑任务或移除入口；用户再次点击只能发送完全相同的无效请求，无法修正也无法清理。代码注释「用户可修正后再次确认」与 UI 实际能力不符；`discardUnknownReport` 只服务 unknown |
| 修复 | ① `PendingReport` 新增 `lastRejection: { code, message } \| null`（加载时归一化，形状非法按 null，不丢记录）；`confirmSubmitOne` 捕获明确拒绝时写入拒绝原因（状态保持 pending）；② 新增 `markPendingReportRejected` / `updatePendingReportQuantities` / 操作集决策纯函数 `pendingItemActions`；③ 视图：被拒绝记录显示红色拒绝横幅 + **默认展开数量编辑器**（「保存修改」→ 更新数量并清除拒绝原因 → 走正常确认提交），每条 pending 记录都有「修改数量」与「移除」出口（含用户无法修正的 30006 类拒绝）；保存后同步草稿，避免再展开时显示旧值 |
| 文件 | `frontend/src/utils/offline-queue.ts`、`frontend/src/utils/pending-item-actions.ts`（新）、`frontend/src/views/mobile/MobileWorkbenchView.vue` |
| 测试 | `pending-item-actions.spec.ts` **9 例**（三态操作集：pending 全开放 / 被拒绝 pending 仍全开放 / unknown 仅可核查后移除 / 非本人全禁）+ 死循环端到端回归（离线入队 → 标记拒绝 → 断言存在编辑与移除出口 → 改数量后拒绝原因清除 → 可再次提交；非法数量不改存储；非法 lastRejection 归一化） |
| 效果边界 | 操作集与队列状态机为纯逻辑单测；真实拒绝后的浏览器交互未验证（见 §10） |

### 11.7 第三轮复测（临时副本 `D:\tmp-s11-verify3`，跑完已删）

| 类别 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 后端单元 | `npx vitest run` | 0 | 45 文件 / 411 例通过（后端仍未改动） |
| 后端无库 e2e | `npm run test:e2e` | 0 | 5 文件 / 60 例通过 |
| 后端 lint | `npx oxlint src/ test/` | 0 | 0 error / 4 warning（既有文件） |
| 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | 0 | 0 error |
| 后端构建 | `npx tsc -p tsconfig.build.json --outDir <临时目录>` | 0 | 0 error |
| 前端测试 | `npx vitest run` | 0 | **31 文件 / 307 例通过**（较第二轮 +1 文件 +9 例） |
| 前端 lint | `npx oxlint src/` | 0 | 0 error / 1 warning（既有 `router/redirect.ts`） |
| 前端类型检查 | `vue-tsc -b`（构建流水线内） | 0 | 0 error |
| 前端构建 | `npm run build` | 0 | 成功，PWA 产物齐全 |

**结论边界**：5 项 P2 的修复目前由**纯逻辑单测 + 类型检查 + 构建**支撑；真实双账号切换、真实超时/断网下的报工结局、真实拒绝后的浏览器编辑交互**未验证**（§10）。本提交**仍为待独立审查**，不自行宣布复审通过。

---

## 12. 提交声明

- 本文件与对应代码为 **「执行方开发完成 + 执行方自测结果」**：§8（首轮）、§11.5（第二轮）、§11.7（第三轮）命令全部实际执行、退出码 0；最新状态以第三轮为准（前端 31 文件 / 307 例，后端 45 文件 / 411 例 + 无库 e2e 60 例）。
- 复审两轮共 5 项 P2（跨账号残留 / 结果不明误标 / 入队不显示 / stepName 污染 / 拒绝死循环）均已修复并复测，**修复证据为纯逻辑单测 + 类型检查 + 构建**。
- **不等于**独立代码复审通过；
- **不等于**真实 MySQL 业务验收（数据库 e2e 未执行，缺口令主动拒绝）；
- **不等于**真实 JWT HTTP 链路验收；
- **不等于**真实浏览器 / 移动设备验收；
- **不等于**完整业务验收、生产数据验收或上线批准。
- S10 复审 P2（产品行锁）仍为「待复审」状态，其真实 MySQL 并发验证（`test/bom-confirm-race.db-e2e-spec.ts`）**仍待授权后补跑**，本会话未触碰该结论。
- 完成后**不自行开始 S12**。


