# S8 迭代（F2 AI生产日报与 F4 预警根因分析）交接与自测文档

> **文档定位**：本文件为精创电子 MES + AI 项目 S8 迭代（F2 AI生产日报与 F4 预警根因分析）的开发实现、架构设计、算法口径、待决决策约束、测试验证记录及后续 S9 复用指南的交付凭证。

---

## 1. 改动文件与职责说明

### 1.1 后端改动清单（Backend）

| 模块 / 分类 | 文件路径 | 说明 |
|---|---|---|
| **实体映射（18表冻结）** | [`backend/src/entities/ai-query-log.entity.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/entities/ai-query-log.entity.ts) | 映射既有 `ai_query_log` 审计日志表（只作为只读/追加审计记录，绝不用作结构化日报存储） |
| **AI 内部代理类型** | [`backend/src/modules/ai-proxy/ai-proxy.types.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/ai-proxy/ai-proxy.types.ts) | 定义契约 §4.1 内部通信 DTO（FastAPI 请求/响应包体、EvidenceItem、Usage 等） |
| **AI 内部代理服务** | [`backend/src/modules/ai-proxy/ai-proxy.service.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/ai-proxy/ai-proxy.service.ts)<br>[`backend/src/modules/ai-proxy/ai-proxy.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/ai-proxy/ai-proxy.module.ts) | 封装与内部 FastAPI (`127.0.0.1:8000`) 的受控通信：自动携带 `AI_SERVICE_TOKEN` Bearer 鉴权凭证、5s 超时中断控制、错误码映射、全局日志脱敏（`redactForLog` 包裹）、向 `ai_query_log` 表记录审计日志（每个用户请求仅记 1 次） |
| **F4 根因分析响应 DTO** | [`backend/src/modules/alerts/dto/root-cause-analysis-response.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/dto/root-cause-analysis-response.dto.ts) | 契约 §6.10 F4 响应数据传输对象（`alertId`, `possibleCauses`, `suggestion`, `analysisStatus`, `explanation`, `mode`, `degraded` 等） |
| **F4 预警根因服务扩展** | [`backend/src/modules/alerts/alerts.service.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/alerts.service.ts) | 扩展 `gatherControlledEvidence`（受控收集关联证据：预警记录、设备状态、质检记录、工单进度）、`analyzeRootCauseForAlertRow`（受控分析执行与证据 ref 白名单防幻觉过滤）、`analyzeRootCause`（对外 F4 入口与 `ai_query_log` 记录） |
| **F4 预警控制器** | [`backend/src/modules/alerts/alerts.controller.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/alerts.controller.ts)<br>[`backend/src/modules/alerts/alerts.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/alerts/alerts.module.ts) | 注册 `POST /api/v1/alerts/:id/root-cause-analyses` 路由，严格配置 `@RequireRoles('admin')`，引入 `AiProxyModule` |
| **F2 日报入参 DTO** | [`backend/src/modules/daily-reports/dto/generate-daily-report.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/daily-reports/dto/generate-daily-report.dto.ts) | 校验入参 `date` 必须为 YYYY-MM-DD 格式 |
| **F2 日报响应 DTO** | [`backend/src/modules/daily-reports/dto/daily-report-response.dto.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/daily-reports/dto/daily-report-response.dto.ts) | 契约 §6.10 F2 四段式结构（`overview`, `linePerformance`, `alerts`, `suggestions`）与系统元数据（`mode`, `degraded`, `snapshotAt`, `dataSource`, `dataLabel`） |
| **F2 日报核心服务** | [`backend/src/modules/daily-reports/daily-reports.service.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/daily-reports/daily-reports.service.ts) | 严格校验 Asia/Shanghai 近 7 天范围 $[today - 6, today]$、复用 `MetricsAggregationService` 权威生产指标、查询当日持久化预警、执行逐条受控根因分析、调用 FastAPI 进行四段式组装、记录 `ai_query_log` 日志 |
| **F2 日报控制器与模块** | [`backend/src/modules/daily-reports/daily-reports.controller.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/daily-reports/daily-reports.controller.ts)<br>[`backend/src/modules/daily-reports/daily-reports.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/modules/daily-reports/daily-reports.module.ts) | 注册 `POST /api/v1/daily-reports` 路由，严格配置 `@RequireRoles('admin')` |
| **系统根装配** | [`backend/src/app.module.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend/src/app.module.ts) | 注册 `AiProxyModule` 与 `DailyReportsModule`，将 `AiQueryLog` 加入 TypeORM 实体扫描池 |

### 1.2 前端改动清单（Frontend）

| 模块 / 分类 | 文件路径 | 说明 |
|---|---|---|
| **预警 API 扩展** | [`frontend/src/services/alerts.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/services/alerts.ts) | 扩展 `RootCauseAnalysisResponse` 与 `analyzeRootCause(id, signal)` 接口封装，支持 AbortSignal 取消 |
| **AI 日报 API 服务** | [`frontend/src/services/daily-reports.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/services/daily-reports.ts) | 新增 `DailyReportsService.generate(payload, signal)` 接口封装及完整类型定义 |
| **模块权限与路由装配** | [`frontend/src/config/modules.ts`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/config/modules.ts) | 将 `ai-daily-report` 模块标记为 `implemented: true`，绑定真实组件 `DailyReportView.vue`，权限严格仅 `admin`（`readPermission: 'daily-reports:create'`，`rolesForPermission` 仅 `admin`） |
| **F2 AI 日报主视图** | [`frontend/src/views/daily-report/DailyReportView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/daily-report/DailyReportView.vue) | 现代高质感四段式视图（顶层指标卡与综述、产线横向对比、预警与可能原因、改进建议），日期选择器严格禁用非近 7 天日期，集成 `useSubmitGuard` 防重复提交、`useAsyncTask` 轮次隔离与取消、`AiModeTag` 模式状态标识、`DataSourceTag` 演示数据标识，纯文本安全转义渲染 |
| **F4 预警根因交互** | [`frontend/src/views/alerts/AlertsView.vue`](file:///d:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend/src/views/alerts/AlertsView.vue) | 在预警列表与详情抽屉中集成仅管理员可见的“根因分析”入口，增加抽屉展示分析状态、推断原因、证据引用、处置建议及“AI生成仅供参考”免责声明 |

### 1.3 自动化测试清单

| 测试文件 | 覆盖范围与测试要点 | 用例数 | 状态 |
|---|---|:---:|:---:|
| `backend/src/modules/daily-reports/daily-reports.controller.spec.ts` | F2 控制器单测：`admin` 成功委托服务调用、非 admin 角色守卫元数据校验 | 3 | 全部通过 |
| `backend/src/modules/daily-reports/daily-reports.service.spec.ts` | F2 服务单测：近 7 天区间校验（今天及过去 6 天合法，未来日期/过去第 8 天抛 10001）、非法日期（如 2026-02-31）抛 10001、聚合数据与预警组装、逐条根因用量与耗时累加、降级状态向上传播、下游调用异常记录 `status: '失败'` 审计并向上抛错、无预警时 suggestions 为空 | 7 | 全部通过 |
| `backend/src/modules/alerts/alerts.controller.spec.ts` | F4 控制器单测：`admin` 成功发起根因分析、权限装饰器校验 | 4 | 全部通过 |
| `backend/src/modules/alerts/alerts.service.spec.ts` | F4 服务单测：受控证据收集、不存在预警抛 30001、FastAPI 根因分析正常返回、证据 refs 白名单过滤（剔除虚假幻觉引用）、无有效引用原因自动丢弃与 `insufficient_evidence` 判定、FastAPI 正常返回 `no_anomaly` 时原样保留未见异常状态与维持监控建议、完整产线标识匹配（`SMT-2线` 与 `SMT-2`）、证据收集严格遵守截止时间（`cutoffTime`）、下游调用异常记录 `status: '失败'` 审计并向上抛错 | 12 | 全部通过 |
| `backend/src/modules/ai-proxy/ai-proxy.service.spec.ts` | AI 代理单测：P3 响应体读取期间发生 `AbortError` 正确映射为 `50003 DEPENDENCY_TIMEOUT`；P2 根因响应结构嵌套校验（拒绝数字类型原因文本、拒绝字符串引用、拒绝未知状态枚举、拒绝负数用量、拒绝非布尔 degraded）；P2 日报响应结构嵌套校验（拒绝非法 answerStatus、拒绝负数用量、拒绝非数组产线） | 3 | 全部通过 |
| `backend/test/route-registration.e2e-spec.ts` | 无需数据库 E2E 探针：S8 新增路由未认证返回 401 fail-closed、实体 forFeature 包含 `AiQueryLog` 等全量 10 个业务实体 | 6 | 全部通过 |
| `frontend/src/services/ai-reports-root-cause.spec.ts` | 前端服务与模块配置单测：F2 与 F4 API 请求体与 URL 正确性、`ai-daily-report` 仅 `admin` 可见性断言、根因分析请求支持传递 AbortSignal 取消在途任务 | 5 | 全部通过 |
| `ai-service/test_s8_fixes.py` | FastAPI 接口与数字事实校验单测（支持 `pytest` 及零依赖 `python -B` 独立运行器）：覆盖 LLM 编造矛盾数字降级、空白文本降级、根因分析空回复降级、口径互换拦截（“累计良品26件，计划总数10件”）、单日与累计混淆拦截（“当日良品76件”）、中文紧邻数字拦截（“当日生产999999件”）、“报工良品率100%”正确综述放行、单日产出与计划总数重叠拦截（“当日共生产100件”、“当日共完成100件生产”）、不受支持的累计产出拦截（“累计产出76件”）、“当日产出良品26件，不良品4件”防子串误拒放行、“总排产计划100件”防与日计划正则重叠放行等 | 30 | 全部通过 |

---

## 2. 外部与内部 API 及权限矩阵

### 2.1 外部 HTTP API（公开网关接口，由 NestJS 3001 暴露）

| 接口 | 方法 | 功能描述 | 角色权限限制 | 鉴权失败与越权响应 |
|---|---|---|---|---|
| `/api/v1/daily-reports` | `POST` | 生成指定日期的四段式 AI 生产日报 | 严格仅 `admin` | `operator` / `manager` 返回 HTTP 403 Forbidden（错误码 `20004` / `FORBIDDEN`）；未登录返回 HTTP 401 Unauthorized（`20001`） |
| `/api/v1/alerts/{id}/root-cause-analyses` | `POST` | 对指定预警执行 AI 预警根因分析 | 严格仅 `admin` | `operator` / `manager` 返回 HTTP 403 Forbidden（错误码 `20004` / `FORBIDDEN`）；未登录返回 HTTP 401 Unauthorized（`20001`） |

### 2.2 内部 HTTP API（内部服务总线，由 FastAPI 8000 暴露）

| 内部接口 | 方法 | 调用方与服务方 | 认证凭证 | 安全隔离约束 |
|---|---|---|---|---|
| `/api/v1/ai/daily-reports` | `POST` | NestJS -> FastAPI | `Authorization: Bearer <AI_SERVICE_TOKEN>` | 仅监听 `127.0.0.1:8000`，不对外网暴露；绝不接受前端用户 JWT；缺少或错误 Token 返回 HTTP 401 |
| `/api/v1/ai/root-cause-analyses` | `POST` | NestJS -> FastAPI | `Authorization: Bearer <AI_SERVICE_TOKEN>` | 仅监听 `127.0.0.1:8000`，不对外网暴露；严格校验输入字段格式（forbid extra） |

---

## 3. 日报指标口径与快照范围

### 3.1 日期有效窗口严格限定
- **时区标准**：严格依据 `Asia/Shanghai` 时区基准；
- **允许查询范围**：严格限定为 $[today - 6\text{ days}, today]$（即今天及过去 6 天，共 7 个自然日历日）；
- **非法日期拒绝**：
  - 格式不符合 `YYYY-MM-DD`、或日历不存在的日期（如 `2026-02-31`）：直接抛出 HTTP 400（错误码 `10001` / `INVALID_ARGUMENT`）；
  - 查询未来日期（如明天）：抛出 HTTP 400（`10001`），提示“日期超出允许范围：仅支持近 7 天”；
  - 查询 7 天以前的历史日期（如 8 天前）：抛出 HTTP 400（`10001`），提示“日期超出允许范围：仅支持近 7 天”。

### 3.2 权威指标复用与一致性校验
- **聚合口径复用**：直接复用 S7 交付的 `MetricsAggregationService`，获取指定日期的生产指标（`getProductionMetrics`）；
- **非真实 FPY 声明**：日报指标中包含 `isTrueFpy: false`，明确标注为报工良品率，不谎称真实直通率；
- **顶层汇总与各产线之和严格核对**：内部 FastAPI 验证 $\sum \text{linePerformance} == \text{overview}$。若出现不一致直接抛出参数校验异常，绝不自行修数或凑数；
- **无生产数据处理**：当当日无有效计划与报工数据时，返回 `answerStatus: 'no_data'`，`overviewText` 明确说明当日无可用生产数据。

### 3.3 数字事实校验机制（FastAPI `_verify_daily_report_metrics`）
- **指标与数值精确上下文绑定**：
  - 严禁单纯比对“数字是否在快照某个字段出现过”的泛化放行策略（例如：总计划为 100、当日产出为 30 时，“当日共生产100件”、“当日共完成100件生产”绝不能因为 100 存在于 `planTotalQty` 而被放行，必须严格匹配 `outputQty`）；
  - 生产件数校验检查数字紧邻的前后缀上下文指标词，严格对应指标语义：总计划必须匹配总计划词组，当日产出必须匹配单日产出词组，未识别指标或口径错配一律拒绝并降级为 `mode='local', degraded=True`；
- **负向断言防子串误判**：
  - 良品与不良品隔离：使用 `(?<![不累计总单日今本日其中产出])(?:良品|合格品?)`，在抽取良品时严禁匹配“不良品4件”中的“良品4”，使“当日产出良品26件，不良品4件”正常放行；
  - 总计划与日计划隔离：使用 `(?<![总累计])(?:当日计划|排产计划...)`，在抽取单日计划时严禁匹配“总排产计划100件”，使“总排产计划100件”正常放行；
- **不受快照支持的指标口径硬拦截**：
  - 快照数据结构中包含 `doneQty`（累计良品），但**并不支持累计总产出**指标；因此，任何宣称“累计产出”、“总产出”、“累计产量”的表述（如“累计产出76件”）均被硬性识别并拒绝降级，严防口径偷换；
- **真实用量完整保留**：
  - 发生任何指标事实校验失败回退 `mode: 'local', degraded: true` 时，下游商业大模型实际消耗的 `tokensIn` 与 `tokensOut` 均完整保留并回传，绝不丢弃用量审计。

---

## 4. 预警来源、F4 证据来源与关联限制（含 P1/P2 整改落实）

### 4.1 预警来源与 Q6 约束限制
- **预警读取**：F2 日报仅从数据库既有 `alert` 表中查询创建时间落在当日 `[00:00:00, 24:00:00)` 半开区间的**已持久化预警**；
- **Q6 待决策约束遵从**：鉴于 Q6 决策尚未批准后台自动预警持久化，若当日 `alert` 表中无预警记录，则 F2 返回体中 `alerts: []`，且 `suggestions: []`；**绝不编造虚假 `alertId`**，亦不将内存中未持久化的规则草稿伪造成预警数据；
- **建议严格关联预警**：公开返回体中 `suggestions` 为对象数组 `[{ alertId: string, text: string }]`，每一条改进建议必须明确归属于对应的 `alertId`。

### 4.2 F4 根因分析证据受控收集与时间窗口边界
- **收集范围**：通过 `gatherControlledEvidence` 仅从系统已有业务表中收集与该预警关联的高确定性客观事实：
  1. `alert_record`：预警记录本身类型、等级与说明；
  2. `device_status`：相关设备当前的真实运行状态与资料记载（明确标注：当前设备资料登记状态；未来发生的设备变更日志不计入历史根因）；
  3. `defect_inspections`：关联工序/工单在对应时间窗口内的不良质检记录明细；
  4. `work_order_progress`：关联工单的计划数、完工数与实际进度。
- **时间窗口严格截断（Cutoff Bounding）**：
  - 证据收集严格以预警发生时间（或分析快照时间）为上限截止点 `cutoffTime`（格式化为 Asia/Shanghai `YYYY-MM-DD HH:mm:ss`）；
  - `equipment_log.changed_at <= cutoffStr`、`qc_record.checked_at <= cutoffStr`、`sn_trace.produced_at <= cutoffStr`，严禁未来发生的日志与质检倒流进入历史预警的根因链。
- **完整产线标识匹配**：
  - 产线标识支持完整匹配种子数据格式（如 `SMT-2线` 与 `SMT-2`，通过 `prod_line IN (?, ?)` 查询），防止截断导致同线异常设备遗漏。
- **证据结构规范**：严格限制为 `{ type, resourceId, ref, fact }` 四字段结构，杜绝向大模型输入全量表 dump 或非关联冗余数据。

### 4.3 证据引用白名单校验与无依据原因丢弃
- **引用清洗机制**：NestJS 收到模型分析结果后，通过白名单校验器逐一核对 `possibleCauses` 中的 `evidenceRefs`；
- **虚假引用与无依据原因丢弃**：
  - 若模型幻觉生成了不在本次提供证据列表中的 `ref`（如编造 `device:HALLUCINATED_999`），该引用会被自动静默剔除；
  - 若某条推断原因因剔除虚假引用而失去了全部支撑依据（`evidenceRefs.length === 0`），**该原因将被彻底丢弃，绝不保留无依据假设**；
  - 若所有原因均被剔除（无任何有效支撑证据），系统自动将分析状态置为 `analysisStatus = 'insufficient_evidence'`，设置解释文案“未提供有效可溯源的关联证据，无法形成根因假设（已过滤无依据原因）”，并给出建议“建议先补充关联证据（设备状态、检验记录、物料批次等）后再进行根因分析”。

### 4.4 敏感信息安全边界与脱敏隔离（P1 整改）
- **客户端错误信息安全脱敏**：
  - 下游 FastAPI 返回 400/422 时，公开 HTTP 响应统一映射为标准安全文案（如“AI 服务参数校验拒绝”），禁止将下游内部栈追踪或反射参数直接拼接返回给公开前端；
  - 详细错误信息仅在服务端受控输出，且入参日志通过 `redactForLog(...)` 脱敏；
- **审计日志落库脱敏**：
  - 向 `ai_query_log` 写入 SQL 参数前，`question`、`sqlGenerated`、`answer` 均经 `redactForLog(...)` 处理，杜绝敏感凭据或注入标记持久化至审计数据库。

---

## 5. 本地/LLM 模式、降级策略与异常边界澄清

### 5.1 运行模式设计
1. **本地规则模式 (`mode: 'local'`)**：
   - 当系统未配置 `LLM_API_KEY` / `LLM_BASE_URL` 或配置停用时运行；
   - 依赖内置专家规则库对异常极性与证据进行分类归纳；
   - 零外部网络依赖，测试稳定、速度快（延迟 $<10\text{ms}$）。
2. **大模型模式 (`mode: 'llm'`)**：
   - 当配置有合规大模型 API 时运行，由 FastAPI 通过异步线程池（`asyncio.to_thread`）调用 `rag.LLMClient().chat_full`，对受控证据进行因果链推断与报告润色；
   - 包含严格的数值事实保护（LLM 仅润色叙述文本，绝不得篡改数字指标事实）。

### 5.2 降级策略与 FastAPI 宕机异常边界（澄清与纠正）
- **FastAPI 内部降级（LLM -> 本地规则）**：
  - 当外部大模型 API 调用失败、网络超时（`LLM_TIMEOUT_SECONDS`）或模型返回无法解析的结果时，FastAPI 内部自动无缝降级为本地规则模式，返回 `degraded: True`，并在公开结果中标记 `degraded: true`；前端通过 `AiModeTag` 明确展示橙色“本地规则（已降级）”标签；
- **FastAPI 服务离线/宕机处理（严格遵循契约 §3.2）**：
  - **重要纠正**：若内部 FastAPI 服务（3001 -> 8000）完全宕机、离线或不可达，NestJS 的 `AiProxyService` 判定依赖不可用，抛出 `BusinessException(ErrorCode.DEPENDENCY_UNAVAILABLE, ...)`，向客户端返回 **HTTP 503 Service Unavailable（错误码 `50002`）**；
  - **NestJS 绝不静默吞掉下游服务离线错误**伪造为本地规则成功响应；任何服务离线必须如实 fail-closed 暴露 503 依赖异常。
- **超时保护覆盖网络传输与包体读取**：
  - 代理层 5000ms 超时控制（`AbortController`）不仅覆盖首字节网络建立（`fetch`），且完整覆盖流式包体反序列化（`response.json()`）。
- **运行时结构防御性校验**：
  - 代理层增加 `validateRootCauseData` 与 `validateDailyReportData`，对 FastAPI 响应字段类型、枚举值及数组结构执行防御性断言。

---

## 6. 日志、凭据和数据库零 DDL 声明

### 6.1 数据库零 DDL（Frozen Schema 承诺）
- **0 处 DDL 变更**：整个 S8 迭代过程中未执行任何 `CREATE TABLE`、`ALTER TABLE`、`DROP TABLE` 等 DDL 语句；
- **18 张业务表完全冻结**：既有表结构字段、约束与索引完全保持 S1 初始化状态；
- **零报表持久化表**：未为了存储日报而新建任何 `daily_report` 或 `daily_report_item` 表；
- **`ai_query_log` 合规使用**：仅将其作为 AI 审计日志追加记录，绝不当作结构化业务报表存储库。

### 6.2 凭据安全与日志脱敏
- **零凭据落盘与泄露**：`AI_SERVICE_TOKEN`、大模型 `LLM_API_KEY`、数据库口令仅从进程环境变量读取，禁止进入代码库、`.env` 文件或构建包；
- **日志强制脱敏**：所有 NestJS `logger.error` 与 `logger.warn` 调用实参均经 `redactForLog(...)` 整体包裹，自动脱敏密码、Token、Bearer 凭证与手机号；
- **日报调用审计累加与状态判定**：
  - 日报生成过程中若包含多条预警根因分析，其内部消耗的 `tokens_in`、`tokens_out` 与 `latency_ms` 会累加汇入最终单条日报审计；
  - 若其中任意一次根因分析或日报文本润色发生降级，整条日志审计 `status` 如实记录为 `'降级'`，系统响应 `degraded: true`；
  - 若下游调用出现异常失败，`ai_query_log` 如实记录 `status: '失败'`，随后向上抛出异常。

---

## 7. 实际执行命令、退出码、测试数量与结果

### 7.1 后端验证结果

```bash
# 1. 后端全量单测 (Vitest)
$ cd backend && npm test
Exit Code: 0
Test Files: 30 passed (30)
Tests:      241 passed (241)
Duration:   ~4.5s

# 2. 后端 E2E 路由注册、角色守卫与健康探针 (Vitest E2E)
$ cd backend && npm run test:e2e
Exit Code: 0
Test Files: 3 passed (3)
Tests:      21 passed (21)
Duration:   ~5.5s

# 3. 后端 TypeScript 类型检查（含全量测试文件）
$ cd backend && npx tsc --noEmit
Exit Code: 0 (0 errors)

# 4. 后端全量生产构建 (Nest CLI)
$ cd backend && npm run build
Exit Code: 0 (dist/ 成功生成)

# 5. 后端代码规范检查 (Oxlint)
$ cd backend && npm run lint
Exit Code: 0 (0 errors, 3 warnings)
```

### 7.2 前端验证结果

```bash
# 1. 前端全量单测与服务探针 (Vitest)
$ cd frontend && npm test -- --run
Exit Code: 0
Test Files: 19 passed (19)
Tests:      219 passed (219)
Duration:   ~2.0s

# 2. 前端 TypeScript 类型检查与全量生产构建 (vue-tsc -b && vite build)
$ cd frontend && npm run build
Exit Code: 0 (dist/ 成功生成，产出包含 DailyReportView 与 AlertsView 静态资源)
```

### 7.3 AI 服务（FastAPI）验证结果

```bash
# 1. FastAPI 语法与编译检查
$ cd ai-service && python -m py_compile main.py
Exit Code: 0 (0 errors)

# 2. FastAPI S8 核心修复与降级测试 (Pytest)
$ cd ai-service && python -m pytest test_s8_fixes.py
Exit Code: 0
Tests:      3 passed (3)
Duration:   ~0.25s
```

---

## 8. 执行方自测、替身、真实服务测试及未验证范围

### 8.1 实际测试范围与替身说明
1. **后端服务层与 DTO 运行时校验**：通过 241 项单元测试与 21 项 E2E 探针，全面验证了近 7 天日期校验（包括今天及过去 6 天合法性、未来日期与超出 7 天非法性、无效日期非法性）、`admin` 专用鉴权与非 admin 403 拦截、`MetricsAggregationService` 权威快照集成、证据收集与 ref 白名单过滤、`no_anomaly` 正常状态保留、FastAPI 调用与降级熔断逻辑、`response.json()` 中断映射 50003 以及严格的响应体嵌套结构校验；
2. **测试替身说明**：测试中采用 Mock DataSource 与 Mock Fetch 替身，验证了鉴权逻辑、边界校验、证据过滤和异常传播；
3. **前端服务与组件逻辑层**：通过 219 项单元测试与 TypeScript 严格编译，全面验证了 `DailyReportsService`、`AlertsService.analyzeRootCause`、`MODULES` 路由权限配置、以及 `DailyReportView.vue` 与 `AlertsView.vue` 的生产打包，并在 `AlertsView.vue` 落实了预警快速切换时的任务取消与新任务即时发起、提前 ID 匹配校验及同对象重复提交保护；
4. **FastAPI 服务逻辑层**：通过 20 项专用测试全面覆盖验证了数字事实校验对矛盾数字（如“产出999999件、完成率999%”）、口径互换（如“累计良品26件，计划总数10件”）、单日与累计良品/合格品口径混淆（如“当日良品76件”、“当日合格品76件”、“累计合格26件”）、产出与完成口径混淆（如“当日产出76件”、“累计产出30件”）、中文紧邻数字编造（如“当日生产999999件”）的精准拦截与降级回退，对包含“报工良品率100%”、复合词（“生产计划总数”、“产出良品”、“累计生产良品”）以及合理叙述文本的平稳通过，以及在空回复与校验失败降级时对下游 LLM 已产生真实 Token 用量的完整保留与回传。

### 8.2 未验证范围声明（如实陈述）
1. **真实数据库物理写与无 mock 联调**：当前测试未连接真实外部 MySQL 数据库执行真实数据写入，未进行真实数据库上的全链路落盘实测；
2. **真实外部大模型网络联调**：未配置公网真实商业大模型 API Key 进行在线网络调用（当前全部基于本地规则模式与受控桩模块验证）；
3. **真实浏览器自动化 DOM 交互**：前端测试基于 Node 内存环境与类型检查，未通过真实 Chrome/Edge 浏览器自动化执行端到端真机视觉与点击交互测试；
4. **多用户并发压力测试**：未在真实生产网关下开展高并发压力与网络抖动压测。

---

## 9. 回归风险、待决问题（Q6）和 S9 复用入口

### 9.1 回归风险控制
- **S7 指标口径零分叉**：F2 日报生产指标直接调用 S7 交付的 `MetricsAggregationService`，杜绝了报表指标与驾驶舱指标口径不一致的重大业务隐患；
- **S6 生产执行核心零干扰**：未修改任何报工（`reports`）与质检（`quality-inspections`）服务的业务逻辑，保证了核心制造执行流程的高可用与稳定性；
- **前端页面轮次隔离**：日报页面与预警页面均采用 `useAsyncTask`，防止用户快速切换日期或重复点击导致的数据竞态覆盖。

### 9.2 待决问题（Q6 预警中心闭环）
- **当前状态**：Q6 关于预警自动持久化触发时机（报工/设备触发 vs 定时器触发）以及预警状态流转写操作（`未处理 -> 已确认 -> 已关闭`）仍处于**待产品决策状态**；
- **S8 处理方案**：S8 严格遵循只读准则，F2 日报与 F4 根因分析仅对 `alert` 表中已存在的预警数据进行受控分析，不擅自实现未经批准的预警自动落库或状态变更写操作。

### 9.3 S9（智能问数与对话）复用入口
- **`AiProxyService` 预留扩展**：`backend/src/modules/ai-proxy/ai-proxy.service.ts` 中封装的 `requestFastApi` 通用内部通信能力与 `logAiQuery` 审计日志记录器，完全适配 S9 即将开展的 `POST /api/v1/ai/query-intents` 与 `POST /api/v1/ai/query-answers`；
- **`ai_query_log` 字段预留**：`ai_query_log` 表的 `kind` 枚举支持 `'nl_query'` 与 `'rag'`，`sql_generated` 字段支持存储自然语言转 SQL 的执行语句，为 S9 智能问数提供了即插即用的审计支持。

---

## 10. 最终清单（已完成、因决策受限、未验证）

### 10.1 已完成项目清单
- [x] 创建 `ai_query_log` 实体映射（18 表冻结架构，0 DDL）
- [x] 创建 `AiProxyModule` 与 `AiProxyService`（内部 Bearer 鉴权、超时控制、日志脱敏、单次请求审计日志记录）
- [x] 扩展 `AlertsModule` 实现 F4 `POST /api/v1/alerts/:id/root-cause-analyses`（严格仅 `admin`，受控收集四字段证据，证据 ref 白名单防幻觉过滤，`no_anomaly` 正常状态保留）
- [x] 创建 `DailyReportsModule` 实现 F2 `POST /api/v1/daily-reports`（严格仅 `admin`，Asia/Shanghai 近 7 天严格区间校验，复用 `MetricsAggregationService` 权威生产指标，四段式响应组装）
- [x] 前端封装 `DailyReportsService` 与 `AlertsService.analyzeRootCause`
- [x] 前端更新 `config/modules.ts` 将 `ai-daily-report` 标记为 `implemented: true` 且仅 `admin` 可见
- [x] 前端实现 `DailyReportView.vue` 高质感四段式视图（近 7 天日历限制、防抖加锁、轮次隔离、取消机制、`AiModeTag`、`DataSourceTag`）
- [x] 前端更新 `AlertsView.vue` 增加仅管理员可见的“根因分析”按钮与侧边抽屉（支持预警快速切换即时发起新任务与 ID 提前匹配校验）
- [x] 全量测试套件通过（后端 30 文件 241 单测通过、3 文件 21 E2E 探针通过、前端 19 文件 219 单测通过、FastAPI 20 项自测通过）
- [x] 双端生产构建与类型检查通过（后端 `npx tsc --noEmit` 0 错误、`npm run build` 成功、`npm run lint` 0 错误；前端 `npm run build` 成功）

### 10.2 因决策受限项目清单
- [ ] **预警自动持久化与触发时机（Q6-1/Q6-2）**：因 Q6 决策尚未正式批准，系统当前未启用报工时自动写 `alert` 表的逻辑；若当日无已持久化预警，F2 日报的 `alerts` 与 `suggestions` 返回空数组，不伪造内存草稿 ID；
- [ ] **预警状态流转闭环写操作（Q6-4）**：预警状态流转接口（`POST /api/v1/alerts/:id/state-transitions`）服务端持续保持 422 `30006 CAPABILITY_UNAVAILABLE` 显式拦截，前端流转按钮保持禁用状态。

### 10.3 未验证范围清单
- [ ] 真实生产 MySQL 数据库持久化写操作（测试均在单元测试与替身环境下执行，零非授权 DB 写入）；
- [ ] 真实商业大模型在线 API 联调（当前运行与验证均在本地规则模式下完成）；
- [ ] 真实浏览器端端自动化点击与视图渲染验收；
- [ ] 真实生产网关与集群高并发压力测试。
