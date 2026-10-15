# S9 迭代（F3 智能问数与对话）交接与自测文档

> **文档定位**：本文件为精创电子 MES + AI 项目 S9 迭代（F3 智能问数）的开发实现、契约映射、口径边界、测试验证记录、**独立审查 P2 修复记录**及未决事项的交付凭证。
>
> **状态**：**待独立审查**（首轮审查 6 项 P2 已修复并复测，等待复审）。本文档不宣称独立验收通过，不宣称上线批准；允许的结论仅限代码层面与执行方自测证据。

---

## 1. 实际实现范围与契约映射

### 1.1 范围总览

| 契约条目                                 | 实现情况                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| §7.1 `POST /api/v1/data-queries`     | ✅ 新增（NestJS 3001 唯一公开入口，admin/manager）                |
| §4.1 `POST /api/v1/ai/query-intents` | ✅ 复用并核对（S3 已有，本轮补关键词与测试）                              |
| §4.1 `POST /api/v1/ai/query-answers` | ✅ 复用并核对（S3 已有，本轮补测试）                                  |
| §5.2 第 18 行权限                        | ✅ 服务端 `@RequireRoles('admin','manager')`，operator 403 |
| 前端入口 `ai-data-query` 模块              | ✅ `implemented: true`，绑定 `DataQueryView.vue`          |
| F1（RAG）/ F2 / F4                     | 不在本轮范围，未改动业务逻辑                                        |

### 1.2 公开接口（唯一，NestJS 暴露）

| 方法 + 路径                     | 请求                                                                                | 响应 data               | 权限                                 |
| --------------------------- | --------------------------------------------------------------------------------- | --------------------- | ---------------------------------- |
| `POST /api/v1/data-queries` | `question:string(1~2000)`, `startDate?:date`, `endDate?:date`, `prodLine?:string` | `QueryAnswer`（见 §1.4） | admin ✓ / manager ✓ / operator 403 |

### 1.3 内部接口（FastAPI 8000，Bearer 服务令牌，复用 S8 AiProxyService）

| 内部路径                            | 用途                            | 本轮改动          |
| ------------------------------- | ----------------------------- | ------------- |
| `POST /api/v1/ai/query-intents` | 自然语言 → 受控意图                   | 关键词扩展（见 §4.1） |
| `POST /api/v1/ai/query-answers` | 只转述 NestJS 提供的 queryResult 数字 | 无逻辑改动，补测试     |

### 1.4 QueryAnswer 响应 DTO（契约 §7.1）

`answerStatus: answered | no_data | clarification_required`；`answer`；`clarification`（澄清时非空）；  
`query: {metric,groupBy,operation,startDate,endDate,prodLine}|null`；`columns[{key,label,type,unit}]`；  
`rows[]`；`sources[{resource,filters}]`；`mode`；`degraded`；`snapshotAt`；`dataSource:"demo"`；  
`dataLabel:"演示数据"`。完成率 rows 必含 `doneQty/planTotalQty/completionRate`，日计划同返 `planQty`；  
趋势逐日带 `dataStatus`（available/no_data/insufficient_data），无报工 `goodRate:null`，真实 0 才记 0。

---

## 2. 修改文件清单

### 2.1 后端（NestJS）

| 文件                                                                  | 变更                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `backend/src/modules/data-queries/data-queries.controller.ts`       | 新增：`POST /api/v1/data-queries`，`@RequireRoles('admin','manager')` + AuthGuard/RolesGuard |
| `backend/src/modules/data-queries/data-queries.service.ts`          | 新增：意图解析→白名单复核→参数仲裁→窗口校验→受控查询→回答生成→单条审计                                                   |
| `backend/src/modules/data-queries/data-queries.query.ts`            | 新增：受控查询执行器（白名单常量/组合矩阵、逐日趋势、defect 聚合、设备状态）                                               |
| `backend/src/modules/data-queries/data-queries.module.ts`           | 新增：模块装配（DashboardsModule + AiProxyModule）                                                |
| `backend/src/modules/data-queries/dto/data-query.dto.ts`            | 新增：请求 DTO（question/startDate/endDate/prodLine，未知字段拒绝）                                    |
| `backend/src/modules/data-queries/dto/query-answer-response.dto.ts` | 新增：QueryAnswer 响应类型                                                                      |
| `backend/src/modules/data-queries/data-queries.service.spec.ts`     | 新增：16 例服务层测试                                                                             |
| `backend/src/modules/data-queries/data-queries.controller.spec.ts`  | 新增：3 例控制器/守卫测试                                                                           |
| `backend/src/modules/ai-proxy/ai-proxy.types.ts`                    | 扩展：F3 内部契约类型                                                                             |
| `backend/src/modules/ai-proxy/ai-proxy.service.ts`                  | 扩展：`callQueryIntents`/`callQueryAnswers` + 两个结构校验器                                       |
| `backend/src/modules/ai-proxy/ai-proxy.service.spec.ts`             | 扩展：5 例 F3 内部通信与校验测试                                                                      |
| `backend/src/app.module.ts`                                         | 注册 `DataQueriesModule`                                                                   |
| `backend/test/route-registration.e2e-spec.ts`                       | `data-queries` 从未启用（404）移入已注册（401）探针                                                     |
| `backend/src/modules/data-queries/data-queries.query.spec.ts`       | 审查修复轮新增：别名解析与组合矩阵 12 例                                                                   |
| `backend/src/modules/dashboards/metrics-aggregation.service.ts`     | 审查修复轮：新增内部 `prodLines` 范围（IN 过滤），对外 DTO 不变                                               |
| `backend/src/modules/dashboards/dashboards.service.spec.ts`         | 审查修复轮：prodLines IN 行为回归 1 例                                                              |
| `backend/src/modules/data-queries/dto/data-query.dto.ts`            | 审查修复轮：可选字段改 `IsOptionalNonNull`（拒绝 null）                                                 |
| `backend/src/modules/data-queries/data-queries.service.ts`          | 审查修复轮：未知产线 no_data、历史设备状态拒绝、null 防御                                                      |
| `backend/src/modules/data-queries/data-queries.service.spec.ts`     | 审查修复轮：+6 例（P2-1/P2-3/P2-4/P2-5）                                                          |
| `backend/src/modules/data-queries/data-queries.query.ts`            | 审查修复轮：`resolveProdLineValues`、组合矩阵收紧、IN 过滤、`unknownProdLineReason`                       |

### 2.2 AI 服务（FastAPI）

| 文件                                  | 变更                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ai-service/main.py`                | 意图关键词扩展（badQty「不良品」/date「哪天/哪日/各天」/「各」构式日期豁免）；审查修复轮：未知产线检测扩到任意「字母段-数字段」、组合矩阵收紧、deviceStatus 历史查询拒绝 |
| `ai-service/test_s9_query_fixes.py` | 新增：31 例 F3 专项测试（含审查修复轮 8 例）                                                                        |

### 2.3 前端（Vue3）

| 文件                                                | 变更                                           |
| ------------------------------------------------- | -------------------------------------------- |
| `frontend/src/services/data-queries.ts`           | 新增：API 封装与类型                                 |
| `frontend/src/views/data-query/DataQueryView.vue` | 新增：F3 页面（提问/示例/结果/趋势表/来源/状态机）                |
| `frontend/src/config/modules.ts`                  | `ai-data-query` → `implemented: true` + 绑定组件 |
| `frontend/src/services/data-queries.spec.ts`      | 新增：5 例服务与模块配置测试                              |
| `frontend/src/utils/query-submit.ts`              | 审查修复轮新增：`decideSubmit` 按问题区分重复提交与新请求         |
| `frontend/src/utils/query-submit.spec.ts`         | 审查修复轮新增：7 例（含 useAsyncTask 切换时序仿真）           |
| `frontend/src/views/data-query/DataQueryView.vue` | 审查修复轮：提交控制改为按问题区分（取消旧轮次 + 清空旧结果）             |

**零 DDL**：未修改 `db/schema.sql`，18 张表冻结；问数链路唯一写操作是经批准的 `ai_query_log` 审计插入（`AiProxyService.logAiQuery`，已有实现）。

---

## 3. 指标口径、查询白名单与权限边界

### 3.1 指标口径（严格区分，不混用）

| 名称                         | 含义                                           | 来源                        |
| -------------------------- | -------------------------------------------- | ------------------------- |
| `planQty`                  | 当日计划（工单计划区间按日分摊，末日补差）                        | MetricsAggregationService |
| `planTotalQty`             | 计划总数（入选工单 qty 之和，每单计一次）                      | 同上                        |
| `doneQty`                  | 累计良品（末道工序累计，截止时刻重建，不回填历史）                    | 同上                        |
| `outputQty/goodQty/badQty` | 查询窗口产出/良品/不良（按报工时间，半开区间）                     | 同上                        |
| `completionRate`           | 累计完成率 = doneQty ÷ planTotalQty ×100          | 同上                        |
| `goodRate`                 | 报工良品率 = goodQty ÷ outputQty ×100，**非真实 FPY** | 同上                        |
| `defectQty`                | 不良类型数量聚合（defect.defect_type，来自已记录不良）         | 受控 SQL                    |
| `deviceStatus`             | 设备当前状态快照（非历史）                                | 受控 SQL                    |

不编造 OEE；趋势按各日期实际工单集合与截止时刻计算，工单集合变化时不假设分母固定。

### 3.2 查询白名单（NestJS 独立复核，不信任下游取值）

- `metric ∈ {goodRate, completionRate, goodQty, badQty, outputQty, defectQty, deviceStatus}`
- `groupBy ∈ {prodLine, date, defectType, device}`
- `operation ∈ {list, trend, minimum, maximum}`
- 组合矩阵：`deviceStatus` 仅 `device+list`；`trend` 仅 `date`；`minimum/maximum` 需可比维度（prodLine/date/device）
- 成本护栏：时间窗口 ≤ 7 天（服务端二次断言）；defect/device 行数 LIMIT 50/100；全部参数化 SQL，不执行模型生成的任意 SQL
- 产线过滤先做**别名解析**（规范编号 → work_task/device 实际名称集合，`IN` 过滤）；无匹配 → no_data 且不扩大为全厂（P2-1）
- 显式日期表述与显式参数不一致 → 10001 要求重述；问题无显式日期表述时显式参数作为补充范围生效（`hasExplicitDateHint` 保守正则）
- 超出近 7 天窗口 → `no_data` 并解释缺失窗口，不制造历史数据
- `deviceStatus` 仅当天放行；历史日期拒绝并要求重述（P2-3）

### 3.3 权限与安全边界

- 公开接口服务端 `@RequireRoles('admin','manager')`，operator 403（20004），未认证 401（20001）；  
  前端隐藏入口不是鉴权，权限判断只用当前用户记录
- 用户身份来自认证上下文（`CurrentUser`），`userContext` 由 NestJS 注入，不信任请求体自报角色
- 内部接口保持服务间 Bearer 认证（AI_SERVICE_TOKEN），不接受用户 JWT
- 问数链路零业务写操作；不清表、不重导、不改既有业务数据、不启用 synchronize
- 响应不返回 SQL、认证配置或调试信息；`ai_query_log.sql_generated` 恒为 null（契约 §4.1：本版不承诺 Text-to-SQL）

---

## 4. 意图解析、回答生成与降级流程

### 4.1 端到端流程

```
用户问题 (+可选显式 startDate/endDate/prodLine)
  → NestJS 参数完备性校验（10001）
  → FastAPI query-intents（本地规则，不调 LLM）
      ├─ supported:false → clarification_required（reason 文案，不查库）
      └─ supported:true  → NestJS 白名单独立复核（不信下游取值）
  → 显式参数仲裁（含显式日期表述冲突 → 10001）
  → 近 7 天窗口校验（范围外 → no_data + 解释）
  → 受控查询（参数化 SQL / 复用 MetricsAggregationService）
      ├─ completionRate 遇计划缺失/非法 → no_data + insufficient_data 说明
      └─ 构建 columns/rows/sources（逐日 dataStatus）
  → FastAPI query-answers（只转述 queryResult 数字）
  → ai_query_log 单条审计（两次内部调用汇总 usage/latency）
```

### 4.2 示例问题映射（需求 §四 F3 原文）

| 示例问题               | 解析意图                                  | 数据来源                             |
| ------------------ | ------------------------------------- | -------------------------------- |
| 今天哪条产线直通率最低？       | goodRate / prodLine / minimum / 今天    | 末道报工（回答附「仅支持报工良品率，非 FPY」说明）      |
| 这周哪天不良品最多？         | badQty / date / maximum / 本周一至今天      | 末道报工逐日                           |
| SMT-2 线这周完成率趋势怎么样？ | completionRate / date / trend / SMT-2 | 工单计划 + 末道累计良品逐日重建                |
| CAL-1 线的主要不良原因是什么？ | defectQty / defectType / list / CAL-1 | defect 表按 qc_record.task_id 归属产线 |

### 4.3 降级与异常边界（复用 S8 AiProxyService）

- FastAPI 不可达/超时 → `50002/50003`，绝不伪造本地成功；
- AbortError 覆盖响应体读取（`response.json()` 期间中断同样映射 50003）；
- 回答文本为确定性本地组装（mode=local），空白/非法 `answerStatus`/`mode`/`degraded` 一律结构校验拒绝（50002）；
- 下游返回 400/422 → 公开响应统一安全文案，明细只进脱敏日志；
- 降级时（`degraded:true`）审计 status=降级，已产生的 tokens/latency 完整保留；
- 澄清、无数据是正常业务结果（HTTP 200 / code 0），不捏造数值。

### 4.4 审计与脱敏

- 每次用户请求只写一条 `ai_query_log`（kind=nl_query），`question`/`answer` 入库前经 `redactForLog`；
- 两次内部调用的 `tokensIn/tokensOut/latencyMs` 汇总记录；成功/降级/失败如实分流；
- 参数冲突（10001）在意图调用已发生时同样记 `status:失败`（保留已产生用量）；
- 口令、密钥、完整令牌不进入代码、日志、审计库与响应。

---

## 5. 前端实现要点

- 入口：`ai-data-query` 模块（/ai/data-query），`data-queries:create` 权限 → admin/manager 可见；
- 展示：问题输入 + 4 个契约示例问题快捷入口；回答文本、口径（指标/维度/操作/日期/产线）、  
  快照时刻、`DataSourceTag` 演示数据标识、`AiModeTag` 模式/降级标识、数据表（趋势含数据状态列）、  
  sources 受控查询范围；
- 状态机：加载（可取消）/澄清/无数据/降级提示/错误+重试/初始空态；
- `useAsyncTask` 轮次隔离 + `onScopeDispose` 取消，快速切换问题旧响应不覆盖新结果；
- 提交控制按问题文本区分（`utils/query-submit.ts` `decideSubmit`）：同一问题在途重复点击被丢弃，  
  切换问题取消旧轮次并清空旧结果后立即发起（P2-6）；
- 模型文本纯文本渲染，不用 `v-html`；
- 不暴露内部 SQL、认证配置或调试信息。

---

## 6. 实际测试命令、结果与证据类别

> 执行环境：Windows + pwsh 7；Node 22.22.2（managed）；Python 3.13.9（`D:\QLDownload\PY\python.exe`，含 fastapi/httpx/pytest）。  
> 测试与构建在**临时副本** `D:\wordbuddy\.tmp-s9\mes-upgrade-starter` 执行（node_modules 以目录联接指向原项目），原项目不留下构建产物。

### 6.1 后端（NestJS）

| 命令                        | 结果                                                                       | 证据类别                |
| ------------------------- | ------------------------------------------------------------------------ | ------------------- |
| npm test（vitest run）      | **32 文件 / 265 例全部通过**（S8 时为 30/241；新增 24 例：data-queries 19 + ai-proxy 5） | 执行方自测（替身）           |
| npm run test:e2e          | **3 文件 / 21 例全部通过**；POST /api/v1/data-queries 未认证 401（fail-closed）探针生效   | 执行方自测（无数据库 HTTP 探针） |
| npx tsc --noEmit          | **0 错误**（含全部测试文件）                                                        | 执行方自测               |
| npm run lint（oxlint）      | **0 错误**，5 条既有警告（均来自 db-e2e 测试文件，非本轮引入）                                  | 执行方自测               |
| npm run build（nest build） | 退出码 0，dist 生成                                                            | 执行方自测               |

### 6.2 前端（Vue3）

| 命令                                      | 结果                                                | 证据类别               |
| --------------------------------------- | ------------------------------------------------- | ------------------ |
| npm test（vitest run）                    | **20 文件 / 224 例全部通过**（S8 时为 19/219；新增 5 例）        | 执行方自测（替身 + 模块配置断言） |
| npm run build（vue-tsc -b && vite build） | 退出码 0；产物含 DataQueryView 静态资源；chunk 大于 500kB 为既有警告 | 执行方自测              |

### 6.3 AI 服务（FastAPI，原项目目录直接执行，无构建产物）

| 命令                                         | 结果                                                                                                              | 证据类别                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| python -m pytest test_s9_query_fixes.py -q | **23 例全部通过**（4 示例问题意图、7 天趋势、未知产线、OEE 拒绝、模糊周期、未来日期、组合矩阵、只转述数字、空结果 no_data、极值挑选、口径说明、服务令牌 fail-closed、未知字段 10001） | 执行方自测（ASGI 替身，无真实 LLM） |
| python -m pytest test_s8_fixes.py -q（回归）   | **30 例全部通过**                                                                                                    | 执行方自测（回归）              |
| python -m py_compile main.py               | 退出码 0                                                                                                           | 执行方自测                  |

### 6.4 覆盖对照（任务书第七节）

| 要求                  | 覆盖  | 证据                                                                   |
| ------------------- | --- | -------------------------------------------------------------------- |
| 契约 4 个示例问题          | 已覆盖 | ai-service 4 例 + 后端示例链路 16 例                                         |
| 7 天趋势与历史截止边界        | 已覆盖 | ai-service 近 7 天趋势用例；后端逐日 7 行升序 + 计划缺失 insufficient 用例               |
| 累计/当日区分、工单集合变化      | 已覆盖 | 复用 MetricsAggregationService（S7 口径），后端断言 rows 含 doneQty/planTotalQty |
| 无数据/缺计划/未知指标/模糊问题   | 已覆盖 | no_data、insufficient_data、supported:false、clarification_required 用例  |
| 意图白名单/非法过滤/注入/越权    | 已覆盖 | NestJS 白名单复核用例；参数化 SQL；E2E 401 探针；RolesGuard operator 403            |
| 模型错误数字/口径交换/空白输出/降级 | 已覆盖 | query-answers 只转述、空 rows no_data、全 null no_data、结构校验拒绝、degraded 审计   |
| 超时/响应体读取失败/畸形嵌套     | 已覆盖 | AiProxy 既有 AbortError 映射 50003 + 本轮 5 例结构校验                          |
| 多调用审计与降级 usage 保留   | 已覆盖 | tokensIn 3+7=10 / tokensOut 4+9=13 汇总断言                              |
| 请求取消与旧响应隔离          | 已覆盖 | 前端 http 层 + useAsyncTask（S4 既有机制）+ service spec 取消用例                 |
| S7/S8 回归            | 已覆盖 | 后端 265（含 S5-S8 既有 241）、E2E 21、前端 224、ai-service S8 30 例全通过           |


> 上表为首轮自测数字；**首轮审查修复后的最终验证矩阵见 §9.7**（后端 283 / 前端 231 / ai-service 31）。

---

## 9. 独立审查 P2 修复记录（2026-10-13 复审轮）

首轮独立审查提出 6 项 P2，全部已修复并补充回归测试；原有用例（S5～S8）全部保持通过。

### 9.1 P2-1 产线编号未映射数据库实际名称

- **问题**：意图解析产出规范编号 `SMT-2`，种子数据实际存 `SMT-2线`，等值过滤返回空结果，可能把已有数据报告成 no_data。
- **修复**：
  - `data-queries.query.ts` 新增 `resolveProdLineValues()`：查询 `work_task` 与 `device` 中实际出现的产线名称，按「去空白 + 去尾部『线』+ 大写」规范化后匹配，得到实际名称集合；
  - 生产/缺陷/设备查询全部改为 `IN (...)` 过滤；`MetricsAggregationService` 新增**内部专用** `prodLines?: string[]`（`ProductionMetricsScope`/`QualityMetricsScope`，不进入对外 DTO，外部 HTTP 不可传）；
  - 无匹配实际名称 → `unknownProdLineReason` → 服务层返回 no_data 并说明「产线不存在，未扩大为全厂查询」。
- **回归**：`data-queries.query.spec.ts`（别名映射/大小写/无匹配/defect IN/device IN）、`data-queries.service.spec.ts`（端到端别名 + 未知产线 no_data）、`dashboards.service.spec.ts`（prodLines IN 行为，S7 口径不回退）。

### 9.2 P2-2 未知产线被静默丢弃

- **问题**：`_unknown_prod_lines` 只检测已知前缀（SMT/ASSY/CAL），「今天XXX-9线的产量」绕过检测、过滤被清空 → 全厂查询。
- **修复**：改为任何「字母段-数字段」形态且不在知识库产线集合即判未知产线（`supported:false`，要求澄清，绝不移除过滤条件）。
- **防误伤**：产品/设备编号（`JC-PLC-2001`、`EQP-SMT-006`）因前导否定前瞻不会命中，已加回归用例；宁可要求澄清，不静默扩大范围。

### 9.3 P2-3 历史设备问题被当作当前状态查询

- **问题**：「昨天设备状态有哪些」解析为合法历史查询，执行器却读当前 `device.status`，响应携带昨天范围，误导为历史状态。
- **修复**：ai-service `query_intents` 对 `deviceStatus` 且日期非今天直接 `supported:false`（说明仅支持当前快照）；NestJS 服务层窗口校验后**独立复核**同一规则（不信下游），返回 clarification_required。设备状态不使用日期窗口（白名单仅 list）。

### 9.4 P2-4 白名单允许执行器未实现的分组

- **问题**：`outputQty/device/list` 被放行，执行器返回按日期行，列声明 device 而行只有 date。
- **修复**：组合矩阵在 ai-service `_is_allowed_combo` 与 NestJS `isAllowedQueryCombo` **同步收紧**：`deviceStatus` 仅 device+list；`defectQty` 允许 defectType/prodLine/date；其余指标仅 prodLine/date；`trend` 仅 date；`minimum/maximum` 仅 prodLine/date。矩阵与执行器实际能力一一对应。

### 9.5 P2-5 `prodLine:null` 通过 DTO 校验后引发异常

- **问题**：`@IsOptional()` 跳过 null，服务只排除 undefined，随后 `null.trim()` → TypeError（500 路径）。
- **修复**：DTO 三个可选字段统一改用项目既有 `IsOptionalNonNull`（只跳过 undefined）；服务层入口显式拒绝 null（10001），双保险。

### 9.6 P2-6 请求期间切换示例问题，新问题未执行

- **问题**：统一提交锁在 A 在途时丢弃 B，最终显示 A 的回答（复现：calls:1、question:B、answer:A）。
- **修复**：视图改用 `utils/query-submit.ts` 的 `decideSubmit(inFlight, next)`——按问题文本区分「重复提交」（相同问题在途 → 丢弃）与「新请求」（不同问题 → `queryTask.reset()` 取消旧轮次、清空旧结果后立即发起）；`useAsyncTask` 轮次隔离保证 A 的迟到响应被丢弃。
- **回归**：`query-submit.spec.ts` 7 例（判定纯函数 + useAsyncTask 时序仿真：A 在途切 B 最终展示 B、在途连发只 1 次、完成后可再提交）。

### 9.7 修复轮验证矩阵（临时副本执行，已清理）

| 命令                                         | 结果                                            |
| ------------------------------------------ | --------------------------------------------- |
| backend `npm test`                         | 33 文件 / **283 例通过**（修复前 265；新增 18 例）          |
| backend `npm run test:e2e`                 | 3 文件 / **21 例通过**                             |
| backend `npx tsc --noEmit`                 | **0 错误**                                      |
| backend `npm run lint`                     | **0 错误**，4 条既有警告（db-e2e 文件）                   |
| backend `npm run build`                    | 退出码 0                                         |
| frontend `npm test`                        | 21 文件 / **231 例通过**（修复前 224；新增 7 例）           |
| frontend `npm run build`                   | 退出码 0（vue-tsc + vite build；产物含 DataQueryView） |
| ai-service `pytest test_s9_query_fixes.py` | **31 例通过**（修复前 23；新增 8 例）                     |
| ai-service `pytest test_s8_fixes.py`（回归）   | **30 例通过**                                    |
| ai-service `py_compile main.py`            | 退出码 0                                         |

---

## 10. 未决问题、未验证项与回归风险

### 7.1 未决问题（不代替用户批准）

- **Q6 仍未批准**：问数不触发任何预警自动持久化或状态流转写操作（未实现相关能力）。
- **10001 冲突判定依赖保守正则**：hasExplicitDateHint 只用于「显式参数 vs 自然语言」冲突判定，  
  宁可误判为冲突（多一次 10001），不静默改写用户已明示范围；意图解析的日期语义以 ai-service 为准。
- **supported:false 统一映射为 clarification_required**：契约允许「澄清/无数据/能力受限」三类状态，  
  本版将不支持的原因文案放入 clarification，前端以黄色提示展示；若产品侧要求区分「能力受限」  
  独立状态，需修订契约后调整。
- **deviceStatus 为当前快照**：不使用日期窗口（白名单仅 list），前端口径展示不含趋势；  
  历史设备状态查询按 P2-3 修复拒绝并要求重述。
- **未知产线检测宁严勿宽（P2-2）**：任意「字母段-数字段」编号不在知识库产线集合即要求澄清，  
  极端情况下问题中出现的非产线编号（如 ISO-9001）会触发一次澄清而非错误数据。
- **产线别名映射规则（P2-1）**：以「去尾部『线』+ 大写」规范化匹配 work_task/device 实际值；  
  若未来种子数据采用完全不同的命名（如「二号线」），需扩展 `normalizeLineCode` 或补映射表。

### 7.2 未验证项（如实声明）

1. **真实 MySQL 全链路**：本轮全部为单测/替身/无数据库探针；未连接真实库执行问数查询与 ai_query_log 落盘验证（未使用任何数据库凭据）。
2. **真实 LLM 联调**：query-answers 为确定性本地组装（mode=local），未配置真实商业模型验证 llm 路径。
3. **真实浏览器闭环**：未执行 Chrome/Edge 端到端点击与视觉验收（前端测试为 Node 环境）。
4. **生产并发与限流**：未做高并发压测；40001 RATE_LIMITED 为占位，未启用。
5. **数据库 e2e 套件（test:e2e:db）本轮未运行**（与 S8 一致，属既有订单/工单回归，不在 F3 范围）。

### 7.3 回归风险

- **ai-service 关键词扩展的解析回归**：新增「不良品」「哪天/哪日/各天」与「各」构式否定前瞻。  
  已用 S8 既有 30 例 + S9 23 例回归覆盖；影响面限于问数意图解析，不触及 RAG/日报/根因。
- **逐日趋势等于 7 次聚合事务**：单请求最多 7 个 REPEATABLE READ 事务（S7 执行器行为），  
  本地库可接受；若后续窗口扩大需重新评估成本护栏。
- **defect 产线归属为 qc_record.task_id 直挂**：与契约「无 task 的检验不推断产线」一致；  
  未经 task 关联的检验记录在有产线过滤时被排除、无过滤时计入总量（不按产线分拆）。
- **路由探针变更**：data-queries 已注册；F1（rag-answers）实现前仍保持 404 探针。

---

## 11. 结论

S9 在冻结契约内完成 F3 智能问数全链路（前端入口 / NestJS 受控查询 / FastAPI 意图解析与回答生成），  
数字口径复用 S7 聚合服务，白名单、权限、审计、脱敏与降级边界齐备；首轮独立审查 6 项 P2 已全部  
修复并复测（§9），执行方自测全部通过。  
**本文档提交「待独立审查」**：真实 MySQL 链路、真实 LLM、真实浏览器闭环与生产并发未经验收，  
在独立审查通过前，不得宣称业务验收通过或上线批准。
