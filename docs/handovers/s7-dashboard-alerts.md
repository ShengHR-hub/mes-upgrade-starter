# S7 迭代（经营驾驶舱与预警中心）交接与自测文档

> **文档定位**：本文件为 S7 迭代（B8 经营驾驶舱与 B10 预警中心）的代码资产、算法口径、待决决策表、验证记录及后续 S8/S9 复用指南的交付凭证。

---

## 1. 交付文件清单与职责说明

### 1.1 后端实现清单（Backend）

| 模块 / 分类 | 文件路径 | 说明 |
|---|---|---|
| **B8 聚合计算服务** | [`backend/src/modules/dashboards/metrics-aggregation.service.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/metrics-aggregation.service.ts) | 生产指标（计划分摊、末道加权、半开区间累计良品重建、缺计划/逆序容错）、质量指标（报工良品率、isTrueFpy=false）、设备指标（真实数量分组、OEE 契约缺失标记）、交付指标（按 dueDate 判定）及统一事务隔离读 |
| **B8 控制器与模块** | [`backend/src/modules/dashboards/dashboards.controller.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/dashboards.controller.ts)<br>[`backend/src/modules/dashboards/dashboards.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/dashboards.module.ts) | 契约 §6.8 4 个指标接口注册与参数校验路由，注入 AuditService 审计 |
| **B8 DTO** | [`backend/src/modules/dashboards/dto/production-metrics-query.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/dto/production-metrics-query.dto.ts)<br>[`backend/src/modules/dashboards/dto/quality-metrics-query.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/dto/quality-metrics-query.dto.ts)<br>[`backend/src/modules/dashboards/dto/device-metrics-query.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/dto/device-metrics-query.dto.ts)<br>[`backend/src/modules/dashboards/dto/delivery-metrics-query.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/dashboards/dto/delivery-metrics-query.dto.ts) | 严格校验 YYYY-MM-DD 格式、startDate<=endDate 逻辑校验；产线与车间过滤入参 |
| **B10 预警核心服务** | [`backend/src/modules/alerts/alerts.service.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/alerts.service.ts) | 预警列表（稳定倒序分页）、预警详情、候选状态流转（未处理→已确认→已关闭）及纯只读规则草稿评估 |
| **B10 控制器与模块** | [`backend/src/modules/alerts/alerts.controller.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/alerts.controller.ts)<br>[`backend/src/modules/alerts/alerts.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/alerts.module.ts) | 契约 §6.9 预警接口注册、严格只读保护（GET 绝不暗写预警）、注入 AuditService 记录操作日志 |
| **B10 DTO** | [`backend/src/modules/alerts/dto/list-alerts-query.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/dto/list-alerts-query.dto.ts)<br>[`backend/src/modules/alerts/dto/alert-state-transition.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/dto/alert-state-transition.dto.ts) | 校验分页与筛选参数；流转状态枚举（未处理/已确认/已关闭）及状态校验 |
| **公共工具扩展** | [`backend/src/common/utils/date-only.util.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/common/utils/date-only.util.ts) | 扩展 daysDifference 与 addDaysDateOnly 工具函数并配套单测 |
| **应用装配** | [`backend/src/app.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/app.module.ts) | 注册 DashboardsModule 与 AlertsModule；同步将 Alert 实体注入 TypeORM 实体扫描池 |

### 1.2 前端实现清单（Frontend）

| 模块 / 分类 | 文件路径 | 说明 |
|---|---|---|
| **B8 驾驶舱 API 服务** | [`frontend/src/services/dashboards.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/services/dashboards.ts) | 契约 §6.8 接口调用，参数直接展开传递（绝不嵌套 `{ params: ... }`），支持 AbortSignal 取消 |
| **B8 驾驶舱主视图** | [`frontend/src/views/dashboard/DashboardView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/dashboard/DashboardView.vue) | 现代高质感看板（生产/质量/设备/交付指标卡、跨产线对比表、内部规则触发条、完整钻取入口、演示数据标记） |
| **B10 预警中心 API 服务** | [`frontend/src/services/alerts.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/services/alerts.ts) | 契约 §6.9 列表、详情、候选状态流转 API |
| **B10 预警中心主视图** | [`frontend/src/views/alerts/AlertsView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/alerts/AlertsView.vue) | 契约化预警列表与抽屉详情、候选流转确认、防抖加锁（useSubmitGuard）、异步轮次隔离（useAsyncTask） |
| **模块与路由装配** | [`frontend/src/config/modules.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/config/modules.ts) | 将 `dashboard`（B8）与 `alerts`（B10）标记为 `implemented: true` 并绑定真实视图组件 |
| **钻取目标页能力补齐** | [`frontend/src/views/orders/OrdersView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/orders/OrdersView.vue)<br>[`frontend/src/views/work-orders/WorkOrdersView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/work-orders/WorkOrdersView.vue)<br>[`frontend/src/views/reports/ReportsView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/reports/ReportsView.vue)<br>[`frontend/src/views/quality-inspections/QualityInspectionsView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/quality-inspections/QualityInspectionsView.vue) | 补齐从驾驶舱钻取时的路由参数读取与自动预填查询（日期范围、产品、工单、任务）；补齐报工与质检页面的日期范围筛选器，确保所有钻取入口真实可用 |

### 1.3 自动化测试套件清单

| 测试文件 | 覆盖范围与测试要点 | 用例数 | 状态 |
|---|---|:---:|:---:|
| `backend/src/modules/dashboards/plan-allocation.util.spec.ts` | 100件7天分摊（`[14,14,14,14,14,14,16]`）、单日全部、跨月、qty小于天数补差、查询窗口首尾相交 | 12 | 全部通过 |
| `backend/src/modules/dashboards/dashboards.service.spec.ts` | 聚合口径验证：末道有效报工加权、中间工序不计成品、累计完成率重建、缺失计划标记 insufficient_data、OEE 缺失项说明、交付按 dueDate 判定 | 9 | 全部通过 |
| `backend/src/modules/dashboards/dashboards.controller.spec.ts` | 控制器单元测试（非直接 HTTP 管道）：Mock 服务依赖下的参数透传与响应结构核验 | 4 | 全部通过 |
| `backend/src/modules/alerts/alerts.service.spec.ts` | 预警列表倒序分页、详情查询、纯规则草稿评估、Q6未批准流转写操作拦截（抛 30006 且不执行 DB UPDATE） | 5 | 全部通过 |
| `backend/src/modules/alerts/alerts.controller.spec.ts` | 控制器单元测试：操作人注入、委托服务调用与权限装饰器元数据 | 3 | 全部通过 |
| `backend/test/route-registration.e2e-spec.ts` | 无需数据库 E2E 探针：公开接口 200、循环探针覆盖 S7 7 条新增路由在未认证时返回 401 fail-closed、未启用路由 404/30001、9 个实体 forFeature 注册绑定 | 6 | 全部通过 |
| `backend/src/s7-independent-review.spec.ts` | S7 独立审查探针：Q6未批准写操作拦截 30006、历史查询严格半开边界排除次日零点、逆序计划/缺失计划容错、原始精确数量比率判断、事务快照读一致性、累计完成量不被当日产量覆盖（昨日50+今日26=76）、DTO非字符串/重复参数校验拒绝、工单列表末道任务精准过滤无 OR EXISTS、事务隔离级别指定失败与内部查询抛错严格向上传播等断言 | 16 | 全部通过 |
| `backend/test/s7-round2.e2e-spec.ts` | 补充 HTTP 探针：五接口 admin/manager 契约读取、operator 403、参数白名单与枚举校验、不存在预警 404/30001、Q6 流转拦截 422/30006 且零 DB 查询 | 7 | 全部通过 |
| `frontend/src/services/dashboards-alerts.spec.ts` | Node 环境服务测试（无 DOM/组件挂载）：API 适配层参数非嵌套展开传递、MODULES 模块声明与路由元数据 | 8 | 全部通过 |
| `frontend/src/s7-independent-review.spec.ts` | 前端 SFC setup 逻辑与参数消费探针：生产看板指标与计算状态展示、内部规则触发条（良品率<97%、完成率<90%、设备维修中）、钻取目标页参数预填及清空重置逻辑 | 12 | 全部通过 |

---

## 2. 数据库零变更声明（Frozen Schema 承诺）

本次迭代开发与整改**严格遵守 18 张 MySQL 业务表冻结规则**：
1. **0 处 DDL 变更**：未向数据库执行任何 `ALTER TABLE`、`CREATE TABLE`、`CREATE INDEX`、`DROP` 等 DDL 语句；
2. **0 个新增字段/索引**：未向 `alert` 表添加任何自定义列（如 `snapshot_time`、`acknowledged_at`、`resolved_at`、`closed_at`）或任何联合唯一索引；
3. **0 个新实体映射**：未新增任何非 18 表范围的数据库实体映射，实体元数据完全符合既有表结构；
4. **严格使用既有列类型约束**：
   - `alert.level` 严格限制在 `VARCHAR(8)`（“紧急”/“重要”/“一般”）；
   - `alert.status` 严格限制在 `VARCHAR(16)`（“未处理”/“已确认”/“已关闭”）；
   - `alert.content` 限制在 `VARCHAR(512)`，仅写入人类可读文本，绝不写入未转义 JSON；
   - `alert.ref_type` 允许为 `NULL`，`alert.ref_id` 为 `BIGINT NULL`。

---

## 3. 契约算法规范与统计口径

### 3.1 报工良品率与非真实 FPY 声明
- **计算口径**：$\text{goodRate} = \frac{\text{goodQty}}{\text{outputQty}} \times 100$，其中 $\text{outputQty} = \text{goodQty} + \text{badQty}$；
- **分母为 0 处理**：若 $\text{outputQty} = 0$，良品率严格返回 `null`（绝不可返回 0 或 100）；
- **非真实 FPY 声明**：所有驾驶舱与分析接口的良品率返回体均显式附带 `isTrueFpy: false`，界面统一命名为“报工良品率”，明确提示非真实一次合格率。

### 3.2 每日计划分摊算法（工单 DATE 区间）
- **区间定义**：以工单自身 `plan_start` 至 `plan_end` 的 DATE 区间（含首尾自然日，共 $N$ 天）；
- **分摊规则**：
  - 前 $N-1$ 天每日计划为 $\lfloor \text{qty} / N \rfloor$；
  - 第 $N$ 天（最后一天）补齐差额：$\text{qty} - (N - 1) \times \lfloor \text{qty} / N \rfloor$；
  - 示例：100 件分 7 天，每日计划为 `[14, 14, 14, 14, 14, 14, 16]`；单日计划为全部数量；当数量小于天数时亦精确补差（前 $N-1$ 天为 0，末日补齐）；
  - **严禁**使用任务 DATETIME 计划替代工单 DATE 计划。

### 3.3 累计完成率（查询集合与历史重建）
- **计划工单集合**：工单计划区间（`plan_start ~ plan_end`）与当前查询窗口存在交集，且满足产品/产线/车间过滤条件的工单集合；
- **公式**：
  $$\text{completionRate} = \frac{\text{doneQty}}{\text{planTotalQty}} \times 100$$
  - `planTotalQty`：入选工单的 `qty` 之和（每张工单仅计一次，多表联接杜绝笛卡尔积放大）；
  - `planQty`：入选工单在查询窗口内的日计划数量之和；
  - `doneQty`：入选工单截至统计截止时刻的末道工序累计良品数；
- **历史截止与今日截止一致性**：
  - 历史日期的完成量从末道有效报工以严格半开区间（`reported_at < 次日 00:00:00`）重新计算重建，彻底排除次日零点瞬态记录，与窗口报工保持口径严格一致；
  - 严格遵循契约累计口径，移除任何用当日窗口产量截断或覆盖历史累计量的逻辑，工单累计量真实反映历史报工总和（例如昨日 50 件、今日 26 件，累计真实返回 76 件）；
  - 代码层面将缺计划检查、候选工单集合、窗口报工及累计读所依赖的全部输入统一纳入同一事务/执行器范围（`executeInTransaction`，指定 REPEATABLE READ 隔离级别）。**彻底移除无条件捕获异常降级重跑逻辑**，指定隔离级别失败或事务内查询异常严格向上传播，绝不静默降低隔离级别或掩盖执行错误；测试中通过替身验证了全流程使用统一事务管理器执行路径与异常向上传播行为，但不声称在未连接真实 MySQL 下已完成多连接并发 MVCC 实测；
  - **绝不**将工单当前的 `done_qty` 静态值回填到历史日期。

### 3.4 空值与缺失数据防护
- 有效计划且无报工：`completionRate = 0`，`goodRate = null`；
- 空工单集合或分母为 0：`completionRate = null`，`calculationStatus = 'no_data'`；
- 存在计划日期缺失（`plan_start/plan_end` 为 null）或逆序计划（`plan_start > plan_end`）的工单：系统进行数据清洗过滤，不抛 500 异常；排除非法计划后若存在缺失则返回 `calculationStatus = 'insufficient_data'`，`completionRate = null`，并抑制交付预警误报，同时保留可独立统计的实际报工数量；
- 预警规则评估采用精确原始数量关系（如 `goodQty * 100 < 97 * outputQty`、`doneQty * 100 < 90 * planTotalQty`），绝不用两位显示舍入值误判临界值；
- 完成率超 100% 时如实展示，**绝不擅自截断为 100%**。

### 3.5 设备与交付指标
- **设备统计**：从 `device` 表实时汇总处于 `运行中`、`待机`、`维修中`、`停机` 的设备真实数量；
- **OEE 规范**：由于当前未接入设备稼动率与节拍采集数据，OEE 严格按契约返回 `null`，状态返回 `insufficient_data`，并在 `missingInputs` 中明确说明依赖缺失；
- **交付统计**：按订单交付日期 `due_date` 落在查询窗口内的销售订单进行统计，按 Q1 规则（当前已确认且关联全部工单完工判定为已完成；未完成且当前时刻超过 `due_date` 判定为延期）。

---

## 4. Q6 决策表、实际批准状态及尚未启用的行为

### 4.1 Q6 最小决策表（提交审计方决策）

| 议题 | 具体方案（建议方案） | 业务与系统影响 | 18 表冻结架构下的限制 | 需批准内容 | 状态 |
|---|---|---|---|---|:---:|
| **Q6-1: 预警触发与持久化时机** | **方案建议**：采用“写操作事务同步触发评估”或“受控只读探测”，GET 接口严格只读。当报工录入后若良品率低于 97% 或设备流转为“维修中”时写入预警表。 | 保证触发时效性；避免定时器跨实例雪崩。 | 18 表无定时任务配置表；GET 接口不得有写副作用。 | 批准由报工/设备状态变更触发写入，还是仅供前端轮询写入。 | **待决策**<br>*(当前仅实现纯只读评估，GET接口绝不写库)* |
| **Q6-2: 去重键与防抖窗口** | **方案建议**：以 `(ruleType, refType, refId, DATE(snapshotAt))` 作为去重逻辑键，同一业务对象同自然日内不重复生成相同预警。 | 避免同一次异常由于连续报工产生大量重复预警记录。 | `alert` 表在 schema.sql 中无唯一约束索引（仅 `PRIMARY KEY (id)`），防重须依赖应用层行锁或内存去重。 | 批准防重窗口粒度（自然日 / 自然小时 / 未处理期间不重复）。 | **待决策**<br>*(未获批前不启用自动持久化)* |
| **Q6-3: 等级映射规则** | **方案建议**：<br>1. 良品率 $< 90\%$ 映射为“紧急”，$90\% \le \text{rate} < 97\%$ 映射为“重要”；<br>2. 完工率 $< 70\%$ 且剩余时间不足 2 天为“紧急”，$< 90\%$ 为“重要”；<br>3. 维修中设备映射为“一般”。 | 建立清晰的预警严重等级区分，便于车间排查优先级。 | `alert.level` 字段在 schema.sql 中为 `VARCHAR(8)`（不是 20），无 DB 枚举校验。 | 批准良品率、完工率、设备异常对应的具体等级枚举映射。 | **待决策**<br>*(纯只读评估中已提供规范草稿)* |
| **Q6-4: 预警状态流转闭环** | **方案建议**：允许 `未处理 -> 已确认 -> 已关闭`；已关闭后若再次发生相同异常，创建新预警而非复用已关闭预警；暂不开放已关闭重开。 | 保证状态流转单向递进，符合审计与追溯要求。 | `alert.status` 字段在 schema.sql 中为 `VARCHAR(16)`（不是 20），无 DB 状态机约束。 | 批准状态机流转方案及是否允许直接关闭/重开。 | **待决策**<br>*(未获批前写操作已严格禁用：服务端抛 422 30006 CAPABILITY_UNAVAILABLE 且不执行任何 DB 查询或 UPDATE，前端 canTransition 显式置为 false 关闭流转操作入口)* |
| **Q6-5: content 字段长度与关联** | **方案建议**：`content` 存储人类可读的纯文本描述（不超过 512 字符长度），杜绝放入未经批准的未转义 JSON；设备预警因无 BIGINT ID，`ref_type` 置为 `null`，编号写入 `content` 文字中。 | 严格遵循 schema.sql 字符约束，防止字符截断。 | `alert.content` 限制为 `VARCHAR(512)`（512 字符长度，非字节）；`ref_id` 是 BIGINT，产线无表，设备编号是字符串。 | 批准非工单对象（设备/产线）在 `alert` 表中的统一记录格式。 | **待决策**<br>*(当前实现严格遵循契约置 null 与文本说明)* |
| **Q6-6: 历史指标快照保存** | **方案建议**：S7 阶段历史数据一律通过末道有效报工实时重构；不引入新的快照表或 Redis 缓存。 | 保证 18 表纯粹性，数据随时具备可溯源性。 | 18 表中无快照表。 | 批准后续 S8/S9 是否继续复用聚合服务重构还是建立只读物化视图。 | **待决策**<br>*(已统一封装于 MetricsAggregationService)* |

### 4.2 尚未启用的行为说明
1. **自动写库完全封锁**：当前系统的任何 GET 请求（包括驾驶舱与预警列表）**绝不暗中向 `alert` 表写入或更新任何数据**；
2. **Q6 未批准状态流转写操作严格禁用**：`POST /api/v1/alerts/:id/state-transitions` 服务端直接抛出 422 `30006 CAPABILITY_UNAVAILABLE`（附带 `{ blockedBy: 'Q6' }`），不执行任何数据库查询或 `UPDATE`；前端 `canTransition` 置为 `false` 关闭确认与关闭按钮；
3. **纯规则评估明确标注**：前端看板与预警中心的规则评估状态条明确标记为“纯只读规则评估”，区分“已持久化预警（来自 alert 表）”与“实时触发草稿（未持久化）”；
4. **未引入任何非批准的后台定时器**：系统零后台 cron、零 Socket.io、零 Redis，完全避免未经授权的后台进程。

---

## 5. 验证命令、退出码、计数和原始结果摘要

### 5.1 后端验证结果

```bash
# 1. 后端全量单测 (Vitest)
$ cd backend && npm test
Exit Code: 0
Test Files: 27 passed (27)
Tests:      219 passed (219)
Duration:   ~4.7s

# 2. 后端 E2E 路由注册、角色守卫与 Q6 探针 (Vitest E2E)
$ cd backend && npm run test:e2e
Exit Code: 0
Test Files: 3 passed (3)
Tests:      21 passed (21)
（注：包含 app.e2e-spec.ts 8 项 + s7-round2.e2e-spec.ts 7 项 + route-registration.e2e-spec.ts 6 项）
Duration:   ~3.4s

# 3. 后端 TypeScript 类型检查（含全量测试文件）
$ cd backend && npx tsc --noEmit
Exit Code: 0 (0 errors)
$ cd backend && node node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile .review-cache/full-tsc.tsbuildinfo
Exit Code: 0 (0 errors)

# 4. 后端全量生产构建 (Nest CLI)
$ cd backend && npm run build
Exit Code: 0 (dist/ 成功生成)

# 5. 后端静态代码检查 (Oxlint)
$ cd backend && npm run lint
Exit Code: 0
Found 0 warnings and 0 errors.
```

### 5.2 前端验证结果

```bash
# 1. 前端全量单测与探针 (Vitest)
$ cd frontend && npm test
Exit Code: 0
Test Files: 18 passed (18)
Tests:      214 passed (214)
Duration:   ~1.8s

# 2. 前端 TypeScript 类型检查 (vue-tsc)
$ cd frontend && npm run typecheck
Exit Code: 0 (0 errors)

# 3. 前端全量生产构建 (vue-tsc -b && vite build)
$ cd frontend && npm run build
Exit Code: 0 (dist/ 成功生成)
```

---

## 6. 回归风险及 S8 / S9 复用入口

### 6.1 S8 / S9 复用入口
- **聚合服务复用**：`MetricsAggregationService`（位于 `backend/src/modules/dashboards/`）已声明为可注入 Provider，导出生产指标（`getProductionMetrics`）、质量指标（`getQualityMetrics`）、设备指标（`getDeviceMetrics`）和交付指标（`getDeliveryMetrics`）；
- **S8 AI 日报与 F4 根因**：可直接通过依赖注入引入 `MetricsAggregationService`，保证 AI 分析与驾驶舱看到的是完全一致的末道有效产量、分摊计划和报工良品率；
- **S9 智能问数**：可直接调用 `MetricsAggregationService` 提供的参数化查询方法，避免 NL2SQL 时误将中间工序报工重复统计或多表联接导致笛卡尔积放大。

### 6.2 协同更正与潜在风险控制
- **S6 遗留关于锁顺序措辞更正**：原 S6 交接文档（`docs/handovers/s6-reports-inspections.md` 第 50 行与第 181 行）已同步修订，将“从根本上避免交叉死锁”更正为“**统一锁顺序（`work_order FOR UPDATE -> work_task FOR UPDATE`）严格规避工单与任务层级间已知的交叉死锁，但不能完全排除极端复杂多表并发或间隙锁引起的其他死锁**”；
- **钻取跳转防竞态**：所有钻取目标页面（工单、报工、质检、订单）均已补齐对应 query 参数预填与 `useAsyncTask` 轮次隔离，防止快速切换导致旧数据覆盖新数据。

---

## 7. 验证层级划分与局限声明（按实际测试范围如实陈述）

1. **前端逻辑层（SFC setup 替身）**：已验证 SFC setup 中的路由参数同步、清空状态重置、服务调用参数透传及提交防抖加锁，但运行于 Node 环境（无 JSDOM / Vue Test Utils，未挂载真实浏览器 DOM），未进行真实 Chrome/Edge 浏览器自动化渲染与真机交互验收；
2. **后端服务与 HTTP SQL 生成层**：已验证控制器/DTO 运行时校验（如拒绝数组参数返回 400）、服务 SQL 生成（末道任务精确匹配、未分配 NULL 匹配）及统一事务管理器执行路径，但测试均使用数据库替身（Mock DataSource），未在真实 MySQL 上执行多连接并发 MVCC 读隔离压测；
3. **真实数据库与 JWT 认证未验证**：当前会话未获真实 MySQL 持久化写操作授权与清库重导授权；真实认证中心未联调，未执行真实用户三角色登录闭环验收。

---

## 8. 完成层级与交付结论

- **代码实现与功能边界**：执行工程师已完成 B8 经营驾驶舱与 B10 预警中心读取能力的开发与问题修复。**能力边界说明**：
  1. **可用且已通过测试的能力**：B8 经营驾驶舱 4 个只读指标接口、B10 预警只读列表/详情查询接口、报工/质检/工单钻取目标页参数消费与末道归属 SQL 生成、内存纯只读规则草稿评估能力已就绪并通过全量单元/逻辑层级测试；
  2. **Q6 待决策禁用能力**：根据 Q6 待决策约束，B10 预警状态变更写路径与自动持久化闭环属于未获批功能。服务端直接返回 HTTP 422 且 code `30006 CAPABILITY_UNAVAILABLE` 显式拦截，绝不执行数据库查询或 `UPDATE`；前端 `canTransition` 显式置为 `false`，界面关闭确认与关闭操作按钮；
- **执行方自测**：执行工程师本地测试（后端 219 项单测/探针 + 21 项 E2E 注册守卫/权限断言 + 前端 214 项单测/SFC setup 探针 + 全量双端构建与完整类型检查）全部通过（绿灯）；
- **独立审查**：整改已响应复审提出的全部问题，测试套件与类型检查已全部通过，交付独立审查方复核；
- **业务验收与上线**：未进行完整业务验收，未上线。

---

等待Codex独立审查
