# MES + AI 接口契约说明书

> 版本：v1.1 设计稿；日期：2026-10-09。已落实 Q1、Q5 与 Q3 的 OEE 验收决策。仅设计，不包含实现代码。
> 技术栈：Vue3 + NestJS + FastAPI + MySQL 8，以本次用户指令冻结。
> 数据库：现有 18 张表保持不变。受限能力及未确认业务规则见第 10 节；相关接口不能被视为已经具备完整生产能力。

## 1. 依据、决策与范围

按以下顺序完整审阅：

1. `docs/需求规格说明书_定稿.md`（v2：B1～B14、F1～F4）。
2. `db/schema.sql`（6 主数据 + 11 业务 + 1 AI 日志，共 18 表）。
3. `docs/升级版MES设计方案.md`（架构背景）。

补充参考 `docs/开发启动指令.md` 的三服务目录、端口。优先级：本次用户指令及已确认决策 > 需求 v2 > 定稿表结构约束 > 架构背景。需求中“技术栈待定”由本次指令解决；背景中的 APS、质量自动锁单、预测、短信/企业微信推送不自动纳入本版。

本次用户已确认：

- 保持 18 张表不变；逐 SN 多工序/多批次追溯、库存出库流水等缺口先列明限制。
- 工单 `doneQty` = 末道工序累计良品；演示使用报工良品率，不等同于真实 FPY。
- 仅按 `admin / manager / operator` 三个角色授权，不进一步按岗位或车间细分。因此 manager 不限制“本车间”，operator 共用报工、检验、批次操作权限。
- Q1：一张生产订单只生成一张工单，编号为 `WO-YYYYMMDD-三位序号`；订单在产、完成、延期按 §6.2 判定。
- Q5：工单 qty 按计划起止日期（含首尾）平均分配每日计划，最后一天补差；完成率为末道工序累计良品 doneQty ÷ 计划总数 ×100。交付 completionRate<90% 预警规则启用。
- Q3 的 OEE 验收调整：接受 `oee:null`、`calculationStatus:"insufficient_data"` 与 missingInputs；验收为“OEE 显示缺失项说明”。设备状态迁移和停机超时阈值仍待确认。

接口状态标记：**可设计**表示字段可由现有表或即时计算提供；**受限**表示必须展示能力边界；**待确认**表示仅冻结候选路径/形状，业务规则未批准前不可启用相关行为。文中的 ID、编号、数量与回答均为契约示例，不是已生成或已验收的数据。

## 2. 通用约定

### 2.1 路由、输入与类型

- 所有业务 HTTP 路径以 `/api/v1` 开头，资源使用复数名词，连字符分词，例如 `/work-orders`、`/quality-inspections`。
- 对外只通过 NestJS 访问；同源代理将 `/api/v1` 转发至 3001。Vue3/PWA 不直接调用 8000，不直连 MySQL。
- JSON 使用 UTF-8，字段 camelCase；数据库 snake_case 由 NestJS 映射，不改列名。
- 表中的 Q 表示 query，B 表示 JSON body，P 表示 path；`?` 表示可选。未标 `?` 的字段必填；`无`表示无请求参数。所有请求拒绝未知字段；禁止客户端写 `createdBy/userId/inspectorId/changedBy/role` 等非该接口明示可写的字段。
- BIGINT ID 使用十进制字符串，如 `"101"`，避免 JavaScript 精度损失。设备/产品/物料 code 是字符串主键，不是 BIGINT。
- INT 数量使用 JSON 整数；新建业务数量须为正，良品/不良数量可为 0。DECIMAL 用字符串，例如 BOM `qty:"2.00"`。比率使用数字，范围与单位由指标说明限定；百分比 96 表示 96%，不是 0.96。
- 日期 `YYYY-MM-DD`；时间 RFC 3339，例如 `2026-10-09T08:30:00+08:00`。业务时区 Asia/Shanghai。日期闭区间查询在服务端转换为当天 00:00 至结束日次日 00:00 的半开时间区间。
- `null` 表示已知缺失/无法计算；数组无结果为 `[]`。不以 0 代替没有数据。
- 列表公共参数 `page?:int=1`、`pageSize?:int=20`，page ≥ 1，pageSize 为 1～100；本版不开放任意排序列，按资源主键升序，日志/报工/检验/预警按时间倒序、ID 倒序稳定分页。
- code/name/spec 等字符串最大长度沿用 SQL；自由问句 `question` 1～2000 字符。所有 code 路径值 URL 编码。外键指向对象必须存在；即使 SQL 未建外键，服务端也要校验。
- PATCH 只接受表格明示的字段，至少一个；不允许 PATCH 绕过状态流转接口。资源标识不可修改。

### 2.2 统一返回与分页

所有业务响应，包括错误，均为 `{code,message,data}`。HTTP 状态表达协议结果，`code` 表达业务结果；成功 `code=0`，不使用 HTTP 200 隐藏失败。

```json
{"code":0,"message":"成功","data":{"id":"101","status":"待确认"}}
```

```json
{"code":0,"message":"成功","data":{"list":[{"id":"101","code":"SO-20261009-001"}],"total":1,"page":1,"pageSize":20}}
```

```json
{"code":10001,"message":"参数错误","data":{"errors":[{"field":"qty","reason":"必须为正整数"}]}}
```

不需返回实体时使用 HTTP 200 和 `data:null`，不用无包体的 204。新建持久资源成功用 201；读取、更新、即时生成/计算用 200。文件导出用 JSON 返回内容（第 6.6/6.8 节），前端下载为文件，保证业务 API 仍遵循统一包体。追踪标识放 `X-Request-Id` 响应头，不增加顶层字段。

后续 API 表格中的“返回 data 示例”均是该接口完整成功响应的 `data` 值；统一加 `code:0,message:"成功"`。`Page(示例)` 是精确定义的展开记法：`{"list":[示例],"total":1,"page":1,"pageSize":20}`，空列表为 `{"list":[],"total":0,"page":1,"pageSize":20}`。实体返回均为下文规定的完整 DTO，不是任意部分字段。

### 2.3 数据来源标识

- 含演示业务数据的实体含 `dataSource:"demo"`、`dataLabel:"演示数据"`；这是响应计算元数据，不能写入不存在的表列。
- 真实主数据含 `dataSource:"enterprise-master"`；RAG 引用带 `sourceName`，回答带 `knowledgeSource:"enterprise-documents"`。
- 列表每条业务实体携带标识；看板/问数/日报/根因/导出响应顶层 data 携带标识。前端必须显式展示“演示数据”，不可只隐藏在字段中。
- 表无 dataset 标志，本版只约定隔离的演示部署。不可在同一库混入真实生产流水后继续统一标成 demo；混合部署需另行确认来源识别方案。
- 跨看板、问数、预警、日报统一使用 NestJS 同一聚合口径及快照；`snapshotAt` 标识数据截至时间，不是新建数据库字段。

### 2.4 并发、提交与错误

订单确认须同一事务完成“确认 + 生成唯一一张工单 + 复制工艺路线为任务 + 审计”；无明细路线则整个事务失败，不生成残缺工单。仅有路线总览不等于有可拆解工序。

报工须同一事务完成“写 report + 累计 work_task + 按末工序累计 work_order.done_qty + 审计”。检验 NG 须同一事务写 `qc_record` 与 `defect`；设备变更须同一事务写 `device` 与 `equipment_log`。提交失败不发布看板刷新事件。

重复确认订单不得再生成工单，需锁定订单并检查已有工单。报工/检验/批次入库等追加操作在断网或超时后不得由前端自动重试；数据库无客户端提交唯一键，持久幂等方案见 Q9。状态更新接受 `expectedStatus`，不匹配返回 409，避免覆盖别人已完成的操作；它是请求控制字段，不是表列。

## 3. 统一错误码

| code | 名称 | HTTP | 使用条件 |
|---|---|---|---|
| 0 | SUCCESS | 200/201 | 成功 |
| 10001 | INVALID_ARGUMENT | 400 | 类型、长度、日期、数量、未知参数、查询范围不合法 |
| 10002 | INVALID_REFERENCE | 400 | 主实体存在，但提交的关联对象不存在或不属于该工单 |
| 10003 | INVALID_QUANTITY | 422 | NG 数量、不良明细数量等业务数量关系不合法 |
| 20001 | UNAUTHENTICATED | 401 | 缺失 JWT、签名错误或声明不合法 |
| 20002 | TOKEN_EXPIRED | 401 | JWT 过期 |
| 20003 | INVALID_CREDENTIALS | 401 | 用户名/密码错误或账号不可登录，统一信息不泄露账号存在性 |
| 20004 | FORBIDDEN | 403 | 当前角色不允许操作；账号已停用 |
| 20005 | PASSWORD_CHANGE_REQUIRED | 403 | 首登限权流程确认并启用后，尚未完成改密 |
| 30001 | RESOURCE_NOT_FOUND | 404 | 路径指向资源不存在 |
| 30002 | RESOURCE_CONFLICT | 409 | 唯一编号冲突、重复创建 |
| 30003 | INVALID_STATE_TRANSITION | 409 | 状态条件不满足或 expectedStatus 冲突 |
| 30004 | REFERENCE_IN_USE | 409 | BOM/路线等被业务引用，删除保护触发 |
| 30005 | MISSING_PREREQUISITE | 422 | 缺少工艺明细/BOM等当前操作的必要输入 |
| 30006 | CAPABILITY_UNAVAILABLE | 422 | 请求超出现有表可支持能力，或指标缺关键输入 |
| 40001 | RATE_LIMITED | 429 | 请求频率/AI 调用并发超过配置限制 |
| 50001 | INTERNAL_ERROR | 500 | 未预期服务器错误，不暴露栈、SQL、密钥 |
| 50002 | DEPENDENCY_UNAVAILABLE | 503 | 数据库、FastAPI 等依赖不可用且无法降级 |
| 50003 | DEPENDENCY_TIMEOUT | 504 | 下游超时且无法降级 |

无数据/知识超纲属于正常业务结果：HTTP 200、code 0，`answerStatus:"no_data"` 或 `"not_found"`，不能捏造数值。LLM 不可用但本地模式可回答也返回成功，`mode:"local"`、`degraded:true`；不能把 FastAPI 整体不可达误标成 LLM 降级成功。

## 4. 三服务职责与内部契约

| 服务 | 部署约定 | 职责 | 不得越界 |
|---|---|---|---|
| Vue3/PWA | frontend，3000 | 页面、扫码、表单校验、JWT 携带、调用业务 API、演示标识 | 不直连库；不持有 AI Key；不计算权威指标；不自行判定最终权限 |
| NestJS | backend，3001 | JWT/RBAC、业务状态/校验/事务、全部 MySQL 写入、受控读取、指标聚合、预警发现、审计、AI 代理 | 不让客户端或模型提交任意可执行 SQL；不重复实现 AI 生成逻辑 |
| FastAPI | ai-service，8000 | RAG 检索与引用、自然语言意图解析、日报文本/建议、预警可能原因、LLM 开关与本地降级 | 不直写业务库；不绕过用户权限；不重新生成另一份演示流水或另算看板数字 |

NestJS 为唯一业务事实入口。FastAPI 使用已建 `knowledge.json`；未配置 `AI_BASE_URL/AI_API_KEY/AI_MODEL` 时必须保持本地模式可用。密钥仅在 AI 服务环境配置，绝不放入 DTO、日志或浏览器。

### 4.1 内部 HTTP（不可暴露给浏览器）

这些也是 `/api/v1` 前缀及复数路径，部署在 FastAPI 8000。以专用服务凭证（Authorization Bearer 服务令牌）认证，不能接受普通用户 JWT 作为服务凭证；公网入口不得路由到这些路径。`requestId` 由 NestJS 生成，`userContext:{userId,role}` 仅由已认证 NestJS 传入。内部 HTTP 返回同样的统一包体。

| 方法与内部路径 | B 请求 | 返回 data 示例 |
|---|---|---|
| POST `/api/v1/ai/rag-answers` | `question:string,topK:int,userContext,requestId:string` | `{"answerStatus":"answered","answer":"加热区故障，设备维修中。","mode":"local","degraded":false,"citations":[{"sourceName":"02_设备清单.xlsx","chunkId":"device-006","relevance":1}],"usage":{"tokensIn":0,"tokensOut":0},"latencyMs":120}` |
| POST `/api/v1/ai/query-intents` | `question:string,dateContext:{today,timeZone},userContext,requestId` | `{"supported":true,"intent":{"metric":"goodRate","groupBy":"prodLine","startDate":"2026-10-09","endDate":"2026-10-09","prodLine":null,"operation":"minimum"},"usage":{"tokensIn":0,"tokensOut":0},"latencyMs":20}` |
| POST `/api/v1/ai/query-answers` | `question:string,queryResult:第7.1节数字与来源DTO,userContext,requestId` | `{"answerStatus":"answered","answer":"SMT-3 线报工良品率为95.00%，为所查询产线最低。","mode":"local","degraded":false,"usage":{"tokensIn":0,"tokensOut":0},"latencyMs":30}` |
| POST `/api/v1/ai/root-cause-analyses` | `alert:预警DTO,evidence:已授权关联数据数组,snapshotAt:string,userContext,requestId` | `{"possibleCauses":[{"text":"设备维修可能影响产能。","evidenceRefs":["device:EQP-SMT-006"]}],"suggestion":"请设备负责人检查加热区故障并反馈恢复时间。","mode":"local","degraded":false,"usage":{"tokensIn":0,"tokensOut":0},"latencyMs":60}` |
| POST `/api/v1/ai/daily-reports` | `date:string,metrics:看板DTO,alerts:含根因的预警数组,snapshotAt:string,userContext,requestId` | `{"overviewText":"演示数据：累计完成率76.00%，累计良品76件，计划总数100件。","suggestions":["请设备负责人检查加热区故障并反馈恢复时间。"],"mode":"local","degraded":false,"usage":{"tokensIn":0,"tokensOut":0},"latencyMs":90}` |

内部指标 intent 的允许集合：`metric=goodRate/completionRate/goodQty/badQty/outputQty/defectQty/deviceStatus`，`groupBy=prodLine/date/defectType/device`，`operation=list/trend/minimum/maximum`。不支持的组合返回 supported false，由 NestJS 返回业务“无可用数据/不支持范围”解释，不调用数据库执行猜测 SQL。NestJS 校验日期、产线、指标白名单、权限，再执行自身受控查询。

本版采用“意图 → 受控查询 → 文本回答”，不承诺任意 Text-to-SQL。`ai_query_log.sql_generated` 可为空。若后续选择模型生成 SQL，需另行批准只读账号、表/列/语句白名单、行数与执行时限方案，不能直接开放原背景方案。

对每次用户 AI 请求，由 NestJS 写一次 `ai_query_log`（kind 对应 nl_query/rag/report/root_cause）；多次内部调用的 tokens/latency 汇总。`user_id` 来自认证身份；回答摘要不得冒充结构化资源持久存储。模型给出的“原因”只能标为可能原因，不触发自动调线、锁单或设备控制。

## 5. JWT 认证与接口权限

### 5.1 认证方案

- 通过 POST `/api/v1/sessions` 登录，账号须 enabled，服务端核对 password_hash，返回访问 JWT。请求头 `Authorization: Bearer <accessToken>`。
- JWT 至少包含 `sub`（用户 ID）、`role`、`iat`、`exp`、`iss`、`aud`；签名使用服务端密钥，校验签名及全部时间/受众/签发者声明。具体有效期、签名算法及刷新/退出即时失效策略见 Q4，不能自行写死为业务定案。
- NestJS 认证后检查当前 sys_user.enabled/role；权限判断使用当前用户记录，不能仅信任旧 JWT 的 role。前端路由隐藏不是鉴权。
- 公共接口仅登录；当前用户可读自身资料与修改自身密码。没有匿名注册、角色自选、客户端指定报工人或检验人。
- 不返回 password_hash；密码、完整 JWT、AI Key 不写 audit_log/ai_query_log。
- 首登强制修改来自 SQL 注释，但 sys_user 无改密状态列，必须解决 Q4 后才能承诺该流程。第 5.3 节提供改密入口，不表示首登限权已落地。

### 5.2 权限矩阵（全部外部接口）

✓ 允许；— 拒绝。当前用户身份操作允许已登录的三角色；“只读”包含该组 GET，其他方法按表拆行。无岗位/车间进一步限制是本次已确认范围，不能悄悄按 post/dept 增加鉴权。

| 接口组/操作 | admin | manager | operator |
|---|---|---|---|
| 登录 `/sessions` | 公共 | 公共 | 公共 |
| 当前用户 GET `/users/me`；POST `/users/me/password-changes` | ✓ | ✓ | ✓ |
| GET `/products`、`/materials`、产品 BOM/工艺路线 | ✓ | ✓ | ✓ |
| POST/PATCH 产品 BOM；DELETE BOM；PATCH 物料安全库存 | ✓ | ✓ | — |
| GET/POST/PATCH `/orders`；POST 订单 confirmations | ✓ | ✓ | — |
| GET `/work-orders`、工单详情、工单 tasks、task详情 | ✓ | ✓ | ✓ |
| PATCH 工单计划；POST 工单/任务 state-transitions；PATCH task分配 | ✓ | ✓ | — |
| GET/POST `/reports` | ✓ | ✓ | ✓ |
| GET/POST `/quality-inspections`；GET `/defects` | ✓ | ✓ | ✓ |
| GET/POST `/material-batches`；SN批次正反查询 | ✓ | ✓ | ✓ |
| GET `/sn-traces`、SN详情、导出；POST/PATCH SN记录 | ✓ | ✓ | ✓ |
| GET `/devices`、状态日志 | ✓ | ✓ | ✓ |
| POST 设备 state-transitions | ✓ | ✓ | ✓ |
| GET 设备 oee-analyses | ✓ | ✓ | — |
| GET `/dashboards/*`；POST 月报 | ✓ | ✓ | — |
| GET `/alerts`、预警详情；POST 预警 state-transitions | ✓ | ✓ | — |
| POST 预警 root-cause-analyses（F4） | ✓ | — | — |
| POST `/data-queries`（F3） | ✓ | ✓ | — |
| POST `/daily-reports`（F2） | ✓ | — | — |
| POST `/rag-answers`；GET `/knowledge-sources`（F1） | ✓ | ✓ | ✓ |
| GET `/quality-analyses/*`（B11） | ✓ | ✓ | — |
| POST `/material-requirement-calculations`（B12） | ✓ | ✓ | — |
| GET/POST/PATCH `/users`、GET `/role-permissions`、GET审计/AI日志 | ✓ | — | — |
| ERP/IoT预留接口（B14） | 未启用 | 未启用 | 未启用 |

operator 读取业务记录在本版不按“仅本人”过滤。manager 查询预警不能附带 F4 根因内容；F4 独立调用由 admin 使用。PWA 复用同一矩阵，不另开绕过鉴权的扫码接口。

### 5.3 认证、用户和审计 API（B9）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| POST `/api/v1/sessions` | B `username:string,password:string` | `{"accessToken":"<JWT>","tokenType":"Bearer","expiresAt":"2026-10-09T10:00:00+08:00","user":{"id":"1","username":"admin","name":"李厂长","role":"admin"}}` |
| GET `/api/v1/users/me` | 无 | `{"id":"1","username":"admin","name":"李厂长","dept":null,"post":null,"role":"admin","phone":null,"enabled":true}` |
| POST `/api/v1/users/me/password-changes` | B `oldPassword:string,newPassword:string`；密码策略待 Q4 | `null` |
| GET `/api/v1/users` | Q 公共分页、`role?:enum,enabled?:boolean,keyword?:string` | `Page({"id":"1","username":"admin","name":"李厂长","dept":null,"post":null,"role":"admin","phone":null,"enabled":true})` |
| POST `/api/v1/users` | B `username:string,name:string,password:string,role:enum,dept?:string,post?:string,phone?:string` | `{"id":"24","username":"operator24","name":"示例操作员","dept":null,"post":null,"role":"operator","phone":null,"enabled":true}` |
| PATCH `/api/v1/users/{id}` | P `id`；B `name?:string,dept?:string/null,post?:string/null,phone?:string/null,role?:enum,enabled?:boolean` | `{"id":"24","username":"operator24","name":"示例操作员","dept":null,"post":null,"role":"operator","phone":null,"enabled":false}` |
| GET `/api/v1/role-permissions` | 无 | `{"roles":[{"role":"operator","permissions":["reports:read","reports:create","quality-inspections:read","quality-inspections:create"]}]}`（示例仅展示一项角色；实际须完整返回本矩阵全部三角色） |
| GET `/api/v1/audit-logs` | Q 分页、`userId?:id,action?:string,startDate?:date,endDate?:date` | `Page({"id":"1","userId":"1","action":"创建订单","target":"sale_order:101","detail":"创建SO-20261009-001","ip":"127.0.0.1","createdAt":"2026-10-09T08:00:00+08:00"})` |
| GET `/api/v1/ai-query-logs` | Q 分页、`userId?:id,kind?:enum,status?:enum,startDate?:date,endDate?:date` | `Page({"id":"1","userId":"1","kind":"rag","question":"EQP-SMT-006状态？","sqlGenerated":null,"answer":"维修中","tokensIn":0,"tokensOut":0,"latencyMs":120,"status":"成功","createdAt":"2026-10-09T08:30:00+08:00"})` |

不提供日志修改/删除接口。避免停用或降级最后一个启用 admin，冲突返回 30002。用户不能通过自身资料接口修改角色或 enabled。新增账号与初始种子账号如何执行首登改密见 Q4。

## 6. 基础业务 API

### 6.1 公共实体示例与字段

以下定义可复用的完整返回 data 示例。后续表中的 `Order`、`WorkOrder`、`Task` 等指向这些具体 JSON 示例，`Page(Order)` 等按第 2.2 节展开。详情使用同一 DTO；关联列表通过单独接口获取，避免详情响应不可控膨胀。元数据 `dataSource/dataLabel` 均只在响应存在。

**Order**（sale_order）：

```json
{"id":"101","code":"SO-20261009-001","productCode":"JC-PLC-2001","qty":100,"dueDate":"2026-10-15","status":"待确认","createdBy":"1","createdAt":"2026-10-09T08:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

**WorkOrder**（work_order）：

```json
{"id":"201","code":"WO-20261009-001","saleOrderId":"101","productCode":"JC-PLC-2001","qty":100,"doneQty":0,"status":"待启动","planStart":"2026-10-09","planEnd":"2026-10-15","createdBy":"1","createdAt":"2026-10-09T08:05:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

**Task**（work_task）：

```json
{"id":"301","workOrderId":"201","seq":10,"stepName":"末道工序示例","workshop":null,"prodLine":"SMT-3","deviceCode":null,"operatorId":null,"planQty":100,"goodQty":0,"badQty":0,"status":"待启动","planStart":null,"planEnd":null,"startedAt":null,"finishedAt":null,"dataSource":"demo","dataLabel":"演示数据"}
```

**Report**（report）：

```json
{"id":"401","taskId":"301","userId":"2","goodQty":76,"badQty":4,"reportedAt":"2026-10-09T08:30:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

**Inspection**（qc_record + defect）：

```json
{"id":"501","workOrderId":"201","taskId":"301","result":"NG","checkQty":80,"ngQty":4,"inspectorId":"3","checkedAt":"2026-10-09T09:00:00+08:00","remark":null,"defects":[{"id":"601","defectType":"虚焊","qty":4,"stepName":"末道工序示例","description":null}],"dataSource":"demo","dataLabel":"演示数据"}
```

**Batch**（material_batch）：

```json
{"id":"701","batchNo":"DEMO-BATCH-001","materialCode":"<已有物料编号>","qty":100,"inboundAt":"2026-10-09","supplier":null,"dataSource":"demo","dataLabel":"演示数据"}
```

**Device**（device）：

```json
{"code":"EQP-SMT-006","name":"回流焊炉","workshop":"<主数据车间>","prodLine":"<主数据产线>","status":"维修中","purchaseYear":null,"supplier":null,"remark":"加热区故障","updatedAt":"2026-10-09T08:00:00+08:00","dataSource":"enterprise-master","statusDataSource":"demo","dataLabel":"演示数据"}
```

**Alert**（alert）：

```json
{"id":"801","level":"重要","type":"质量异常","title":"SMT-3良品率低于97%","content":"演示报工良品率95.00%，不等同于真实FPY","refType":null,"refId":null,"status":"未处理","createdAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

Device 示例车间/产线使用主数据原值，不从编号推导；物料占位标记表示须选择已存在的企业主数据编号，不新增虚构主数据。

### 6.2 订单（B1）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/orders` | Q 分页、`status?:订单枚举,productCode?:string,keyword?:string,dueDateFrom?:date,dueDateTo?:date` | `Page(Order)` |
| GET `/api/v1/orders/{id}` | P `id` | `Order` |
| POST `/api/v1/orders` | B `code:string,productCode:string,qty:int,dueDate:date` | `Order`；201 |
| PATCH `/api/v1/orders/{id}` | P `id`；B `productCode?:string,qty?:int,dueDate?:date`；仅待确认 | `Order`（返回修改后值） |
| POST `/api/v1/orders/{id}/confirmations` | P `id`；B `expectedStatus:"待确认"`；一单一工单 | `{"orderId":"101","status":"已确认","workOrders":[{"id":"201","code":"WO-20261009-001","taskCount":10}],"dataSource":"demo","dataLabel":"演示数据"}` |

**一单一工单（Q1 已确认）**：一张生产订单只生成一张工单，工单 productCode/qty 取自订单。返回保留 workOrders 数组，成功确认后长度必须为 1，不支持按批次或数量拆单。工单编号为 `WO-YYYYMMDD-三位序号`，例如 `WO-20261009-001`；日期使用确认日的 Asia/Shanghai 日期，日序号为三位数字。生成须并发安全并遵守 work_order.code 唯一约束，不得产生重复编号；日序号耗尽时返回 30002，不擅自扩大位数。

重复确认已确认订单返回现有唯一工单及当前订单状态，不能再次创建，也不重新编号；此恢复读取行为不因 expectedStatus 为待确认而拒绝。SQL 的 sale_order_id 未加唯一约束，NestJS 必须锁定订单并在同一事务检查关联工单；发现已有多张工单则返回 30002 并报告数据冲突，不自动删单或任选一张。

订单状态采用数据库原值：`待确认/已确认/生产中/已完成/已延期`。判定为：**在产**表示有关联工单状态为在产，映射为订单 `生产中`；**完成**表示所有关联工单完工，映射为 `已完成`（须至少有一张关联工单，空集合不算完成）；**延期**表示业务当前日期 > dueDate 且未完成，映射为 `已延期`。单字段显示顺序为已完成优先、未完成且超期显示已延期、否则有在产工单显示生产中；其余维持待确认/已确认。延期日相等不触发，已完成即使超期也不显示已延期。工单状态变更及跨日查询须同步判定，不能因无新报工而漏掉跨日延期。

本版无删除订单、取消订单接口（表无取消状态）。工单暂停/关闭的状态流转仍见 Q2；关闭不等于完工，不能据此认定订单已完成。

### 6.3 工单、工序任务（B2）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/work-orders` | Q 分页、`saleOrderId?:id,productCode?:string,status?:工单枚举,keyword?:string,prodLine?:string,workshop?:string` | `Page(WorkOrder)` |
| GET `/api/v1/work-orders/{id}` | P `id` | `WorkOrder` |
| PATCH `/api/v1/work-orders/{id}` | P `id`；B `planStart?:date/null,planEnd?:date/null`；仅待启动，起日≤止日 | `WorkOrder`（修改后值） |
| GET `/api/v1/work-orders/{id}/tasks` | P `id`；Q 分页、`status?:任务枚举` | `Page(Task)` |
| GET `/api/v1/tasks/{id}` | P `id` | `Task` |
| PATCH `/api/v1/tasks/{id}` | P `id`；B `deviceCode?:string/null,operatorId?:id/null,prodLine?:string/null,planStart?:datetime/null,planEnd?:datetime/null`；人工分配规则待 Q2 | `Task`（修改后值） |
| POST `/api/v1/work-orders/{id}/state-transitions` | P `id`；B `expectedStatus:工单枚举,targetStatus:工单枚举` | `{"id":"201","status":"在产","dataSource":"demo","dataLabel":"演示数据"}` |
| POST `/api/v1/tasks/{id}/state-transitions` | P `id`；B `expectedStatus:任务枚举,targetStatus:任务枚举` | `{"id":"301","status":"在产","startedAt":"2026-10-09T08:20:00+08:00","finishedAt":null,"dataSource":"demo","dataLabel":"演示数据"}` |

工单枚举：`待启动/在产/暂停/完工/关闭`；任务枚举：`待启动/在产/完工`。需求确定主线 `待启动→在产→完工`，暂停/恢复/关闭、顺序前置、完工阈值和自动触发点须 Q2 确认。不能因为 SQL 有枚举注释就允许任意两状态互转。

工序生成复制 route 的 seq/stepName/workshop/prodLine 到任务，planQty 来源于工单 qty；`key_device` 是 VARCHAR(64) 描述，不保证为 device.code，不能自动当外键分配。人工分配设备须真实设备存在；是否要求同产线/运行状态见 Q2。无独立随意创建工单或任务接口，避免破坏订单确认闭环；不提供 APS 自动排产。

### 6.4 报工（B3）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/reports` | Q 分页、`taskId?:id,workOrderId?:id,userId?:id,startDate?:date,endDate?:date,prodLine?:string,workshop?:string,productCode?:string` | `Page(Report)` |
| POST `/api/v1/reports` | B `taskId:id,goodQty:int,badQty:int`；二者≥0，和>0 | `{"report":{"id":"401","taskId":"301","userId":"2","goodQty":76,"badQty":4,"reportedAt":"2026-10-09T08:30:00+08:00","dataSource":"demo","dataLabel":"演示数据"},"taskTotals":{"goodQty":76,"badQty":4},"workOrderTotals":{"doneQty":76},"dataSource":"demo","dataLabel":"演示数据"}`；201 |

扫码得到工单 code 后查询 work-orders keyword，选择其真实 taskId 后提交报工，不把扫码内容当 SQL 或数据库连接串。仅在工单/任务在产且用户启用时提交；超计划、返工、重复报工、自动完工规则见 Q2/Q9。report.user_id = JWT 当前用户；reported_at 为服务端提交时间。本版无编辑/删除报工入口，不以删除记录修正累计数。

末道工序定义为工单内 seq 最大任务；生成任务时必须保证 seq 唯一（SQL 的 idx_task_wo 不是唯一约束）。仅末道任务 report.good_qty 增量计入 doneQty，中间工序不累加工单完工量；task.good_qty/bad_qty 等于该任务所有有效报工之和。检验 NG 不再重复扣减报工良品；若需返工/报工冲销，另行设计。

### 6.5 检验、不良与 SPC（B4/B11）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/quality-inspections` | Q 分页、`workOrderId?:id,taskId?:id,result?:检验枚举,startDate?:date,endDate?:date,prodLine?:string,workshop?:string,productCode?:string` | `Page(Inspection)` |
| GET `/api/v1/quality-inspections/{id}` | P `id` | `Inspection` |
| POST `/api/v1/quality-inspections` | B `workOrderId:id,taskId?:id,result:检验枚举,checkQty:int,ngQty:int,remark?:string,defects?:[{defectType:string,qty:int,description?:string}]` | `Inspection`；201 |
| GET `/api/v1/defects` | Q 分页、`qcRecordId?:id,workOrderId?:id,defectType?:string,startDate?:date,endDate?:date` | `Page({"id":"601","qcRecordId":"501","defectType":"虚焊","qty":4,"stepName":"末道工序示例","description":null,"createdAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"})` |
| GET `/api/v1/quality-analyses/paretos` | Q `startDate:date,endDate:date,prodLine?:string` | `{"items":[{"defectType":"虚焊","qty":4,"share":100,"cumulativeShare":100}],"totalDefectQty":4,"dataSource":"demo","dataLabel":"演示数据"}` |
| GET `/api/v1/quality-analyses/trends` | Q `startDate:date,endDate:date,prodLine?:string,stepName?:string` | `{"metric":"reportBadRate","points":[{"date":"2026-10-09","goodQty":76,"badQty":4,"badRate":5}],"dataSource":"demo","dataLabel":"演示数据"}` |
| GET `/api/v1/quality-analyses/good-rates` | Q `startDate:date,endDate:date,prodLine?:string` | `{"metric":"reportGoodRate","value":95,"isTrueFpy":false,"dataSource":"demo","dataLabel":"演示数据"}` |

检验枚举为 `OK/NG`。checkQty>0；0≤ngQty≤checkQty。OK 要求 ngQty=0 且 defects为空；NG 要求 ngQty>0 且至少一项 defect，明细 qty>0，明细之和=ngQty。本版按不良件单一主类型计数，不能同时用同一件多类型叠加数冒充 NG 件数。taskId 若存在必须属于 workOrderId；stepName 从任务取值，未关联工序时为 null，inspectorId 从 JWT 取值。不良记录由检验事务自动创建，不设独立 POST defects。

Pareto 使用 defect.qty，按 qty 降序、defectType升序排列；同件多缺陷体系另行确认。工序趋势使用报工数量，不混加质检 ng_qty。无 task 的检验不能推断产线，应显示“未分配”，请求特定产线时不纳入该产线。全部质量分析注明“报工良品率/报工不良率”；不将 good-rates 改名为真实 FPY。

### 6.6 物料、BOM、批次与 SN（B5/B6）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/products` | Q 分页、`keyword?:string,line?:string` | `Page({"code":"JC-PLC-2001","name":"<企业产品名称>","line":"工业控制板卡","monthlyOutput":0,"unit":"片","stdHours":"0.00","remark":null,"dataSource":"enterprise-master"})` |
| GET `/api/v1/products/{code}/process-routes` | P `code`；Q 分页（本资源按 seq升序） | `Page({"id":"1","productCode":"JC-PLC-2001","seq":1,"stepName":"<真实工序名称>","workshop":null,"prodLine":null,"stdMinutes":"0.00","keyDevice":null,"qcPoint":null,"dataSource":"enterprise-master"})` |
| GET `/api/v1/products/{code}/boms` | P `code`；Q 分页 | `Page({"id":"1","productCode":"JC-PLC-2001","level":1,"materialCode":"<已有物料编号>","qty":"2.00","unit":"只","dataSource":"enterprise-master"})` |
| POST `/api/v1/products/{code}/boms` | P `code`；B `materialCode:string,level:int,qty:decimal-string,unit?:string` | `{"id":"31","productCode":"JC-PLC-2001","level":1,"materialCode":"<已有物料编号>","qty":"2.00","unit":"只","dataSource":"enterprise-master"}`；201 |
| PATCH `/api/v1/boms/{id}` | P `id`；B `level?:int,qty?:decimal-string,unit?:string/null` | 同上 BOM DTO（更新后值） |
| DELETE `/api/v1/boms/{id}` | P `id`；仅无关联已确认订单/工单时，引用保护 | `null` |
| GET `/api/v1/materials` | Q 分页、`keyword?:string,category?:string` | `Page({"code":"<已有物料编号>","name":"<企业物料名称>","spec":null,"category":"芯片","unit":"只","safetyStock":20,"supplier":null,"remark":null,"dataSource":"enterprise-master"})` |
| PATCH `/api/v1/materials/{code}` | P `code`；B `safetyStock:int`（≥0） | 上述 Material DTO（更新后值） |
| GET `/api/v1/material-batches` | Q 分页、`materialCode?:string,batchNo?:string,inboundDateFrom?:date,inboundDateTo?:date` | `Page(Batch)` |
| POST `/api/v1/material-batches` | B `batchNo:string,materialCode:string,qty:int,inboundAt:date,supplier?:string` | `Batch`；201 |
| GET `/api/v1/material-batches/{id}/sn-traces` | P `id`；Q 分页 | `Page(SnTrace)`（定义如下） |
| GET `/api/v1/sn-traces` | Q 分页、`sn?:string,workOrderId?:id,batchId?:id` | `Page(SnTrace)` |
| POST `/api/v1/sn-traces` | B `sn:string,workOrderId:id,taskId?:id,deviceCode?:string,batchId?:id,qcResult?:检验枚举` | `SnTrace`；201 |
| PATCH `/api/v1/sn-traces/{sn}` | P `sn`；B `taskId?:id,deviceCode?:string,batchId?:id,qcResult?:检验枚举` | `SnTrace`（更新后值，仅当前快照，不保存历史） |
| GET `/api/v1/sn-traces/{sn}` | P `sn` | `{"trace":SnTrace,"context":{"tasks":[Task],"inspections":[Inspection]},"coverage":"single-snapshot-with-work-order-context","limitations":["工单级记录不能证明该SN逐工序经历","一个SN仅支持一个批次"],"dataSource":"demo","dataLabel":"演示数据"}` |
| POST `/api/v1/sn-traces/{sn}/exports` | P `sn`；B `format:"json"` | `{"fileName":"DEMO-SN-001-trace.json","mediaType":"application/json","content":"{\"sn\":\"DEMO-SN-001\",\"coverage\":\"single-snapshot\",\"dataLabel\":\"演示数据\"}","coverage":"single-snapshot-with-work-order-context","dataSource":"demo","dataLabel":"演示数据"}` |

**SnTrace**（sn_trace）：

```json
{"id":"901","sn":"DEMO-SN-001","workOrderId":"201","productCode":"JC-PLC-2001","taskId":"301","operatorId":"2","deviceCode":null,"batchId":"701","qcResult":"NG","producedAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

SN 写入的 productCode 从工单读取、operatorId 取 JWT；task必须属于工单，设备/批次须存在。qcResult 只是 SN 快照字段，不证明与某张 qc_record 逐件绑定。PATCH 不改 producedAt，不伪造历史事件。扫码 SN 查询精确路径，不以模糊匹配替代追溯。

BOM qty>0、level≥1，同一 product/material 不得重复。现表 level 不是父子关联，禁止根据 level 推断 BOM 树递归展开。为避免无版本 BOM 改写已确认订单的计算依据，本版对有关联已确认订单或工单的产品 BOM 修改/删除返回 30004；如需在产变更，先确认版本/快照方案。

批次 qty 仅按现有“入库数量”解释；不能声称是可用库存。没有出库、占用或调整 API。SN 只能绑定一个批次；上下文里的工单工序/检验是关联参考，不展示为该 SN 的已证实全链路。JSON 导出保留限制说明，不能宣称满足 IATF 16949；PDF追溯格式/合规验收见 Q7。

### 6.7 设备（B7）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/devices` | Q 分页、`workshop?:string,prodLine?:string,status?:设备枚举,keyword?:string` | `Page(Device)` |
| GET `/api/v1/devices/{code}` | P `code` | `Device` |
| POST `/api/v1/devices/{code}/state-transitions` | P `code`；B `expectedStatus:设备枚举,targetStatus:设备枚举,remark?:string` | `{"device":Device,"logId":"1001"}`（设备为新状态） |
| GET `/api/v1/devices/{code}/state-logs` | P `code`；Q 分页、`startDate?:date,endDate?:date` | `Page({"id":"1001","deviceCode":"EQP-SMT-006","oldStatus":"运行中","newStatus":"维修中","changedBy":"2","remark":"加热区故障","changedAt":"2026-10-09T08:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"})` |
| GET `/api/v1/devices/{code}/oee-analyses` | P `code`；Q `startDate:date,endDate:date` | `{"deviceCode":"EQP-SMT-006","availability":null,"performance":null,"quality":null,"oee":null,"calculationStatus":"insufficient_data","missingInputs":["计划生产时间","设备产出归属","理想节拍"],"dataSource":"demo","dataLabel":"演示数据"}` |

设备枚举使用 `运行中/待机/维修中/停机`。allowed transitions、停机超时阈值待 Q3，不能默许任意跳转。状态日志仅由变更接口写，不能伪造过去时间。EQP-SMT-006 在演示数据中保持“维修中/加热区故障”；演示固定约束与人工状态变更冲突时，返回 30003，不让 AI 修改它。

OEE 需要 A×P×Q；只有状态变更日志不够。prod std_hours 与工序 std_minutes 不能未经确认当作某台设备理想节拍。没有班次日历及设备级产量、首次合格件数据时返回 `oee:null`、`calculationStatus:"insufficient_data"` 和实际 missingInputs，不编造数字。**Q3 的 OEE 验收已确认调整为“OEE 显示缺失项说明”**，替代原需求“OEE有数字”；前端明确展示缺失项，不将 null 显示成0。设备状态流转与停机阈值仍是 Q3 的剩余待确认事项。

### 6.8 经营驾驶舱与月报（B8）

权威汇总按报工时间选取末道任务的有效 report：`outputQty=goodQty+badQty`，`goodRate=goodQty/outputQty×100`；跨线汇总先加数量再算比率，不算产线比率的算术平均。归属使用末道任务 prodLine，null 分组“未分配”。报工产量的计算不将各中间工序重复加为成品数。

**Q5 已确认：每日计划与累计完成率是两个不同的指标。** 工单计划区间为 planStart～planEnd，含首尾自然日。设天数 N，每日前 N-1 天的计划数为 `floor(qty/N)`，最后一天为 `qty-floor(qty/N)×(N-1)`，区间外为0；每日计划之和必须等于工单 qty。例如 qty=100、2026-10-09～2026-10-15，共7天，计划数为 `[14,14,14,14,14,14,16]`。单日计划即全部 qty；qty 小于天数时前几天可为0，差额全部在最后一天补齐。

完成率固定为 `completionRate = doneQty / planTotalQty ×100`。对单工单，doneQty 是末道工序累计良品，planTotalQty 是工单 qty；对产线/工厂，先分别合计所选工单 doneQty 和 qty，再相除，不平均各工单比率。**每日 planQty 不是累计完成率的分母，当日 goodQty 也不是累计 doneQty。** 日分摊用 work_order 的 DATE 计划，不用任务 DATETIME 计划替代。

日期查询的计划工单集合为计划区间与查询窗口相交、且符合产品/车间/产线过滤条件的工单；归属与 §6.8 产量一致，按末道任务所属产线/车间，缺失归入“未分配”。planQty 为该集合在查询窗口内的日计划之和，planTotalQty 为该集合工单 qty 之和（每工单计一次）。doneQty 为该集合截至统计截止时刻的末道累计良品，不是只计窗口内良品；窗口内 outputQty/goodQty/badQty 仍按报工时间统计，响应明确区分这两组数值。

当前截止时刻使用 snapshotAt；历史日报/趋势截止到对应日末（今天截止到 snapshotAt），累计良品从末道 report 重建，不能把现在的 work_order.done_qty 回填所有历史日期。趋势的每个日期按同样的计划区间相交规则选择工单、注明 planTotalQty；工单集合变化时不可假设分母固定。基础看板、F2/F3/F4共享以上计算与快照。

合法工单集合且 planTotalQty>0 时返回数值 completionRate 和 `calculationStatus:"available"`，不再因定义待定返回 null。空集合/分母0返回 null、`calculationStatus:"no_data"`；计划日期缺失或非法则返回 `calculationStatus:"insufficient_data"` 与 missingInputs，不能猜日计划或当作0。完成率不擅自截断到100%，超计划报工规则仍见 Q2。

后续演示数据生成器必须按该口径设置完整计划日期、分摊每日计划并生成末道报工，验证日计划之和=工单 qty、累计良品=doneQty、各产线汇总=工厂汇总。固定随机种子只控制造数，不能改变以上公式；生成器实现留待后续会话。

下述 **Dashboard** 为已确认口径示例：一张 qty=100、计划2026-10-09～2026-10-15的工单，截至09日09:00累计良品76，当日计划14，计划总数100：

```json
{"startDate":"2026-10-09","endDate":"2026-10-09","snapshotAt":"2026-10-09T09:00:00+08:00","metrics":{"planQty":14,"planTotalQty":100,"doneQty":76,"outputQty":80,"goodQty":76,"badQty":4,"completionRate":76,"goodRate":95,"isTrueFpy":false,"calculationStatus":"available"},"lines":[{"prodLine":"SMT-3","planQty":14,"planTotalQty":100,"doneQty":76,"outputQty":80,"goodQty":76,"badQty":4,"completionRate":76,"goodRate":95}],"dataSource":"demo","dataLabel":"演示数据"}
```

上例累计完成率为76/100=76%，报工良品率为76/80=95%；即使首日产量高于日计划14，也不能以76/14作为累计完成率。当日 goodQty 与 doneQty 恰好相等仅是首日示例，跨日不保证相等。

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/dashboards/production-metrics` | Q `startDate:date,endDate:date,prodLine?:string,workshop?:string,productCode?:string` | `Dashboard` |
| GET `/api/v1/dashboards/quality-metrics` | Q 同上 | `{"goodQty":76,"badQty":4,"goodRate":95,"isTrueFpy":false,"snapshotAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}` |
| GET `/api/v1/dashboards/device-metrics` | Q `workshop?:string,prodLine?:string` | `{"counts":{"运行中":1,"待机":0,"维修中":1,"停机":0},"oee":null,"calculationStatus":"insufficient_data","missingInputs":["计划生产时间","设备产出归属","理想节拍"],"snapshotAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}` |
| GET `/api/v1/dashboards/delivery-metrics` | Q `startDate:date,endDate:date,productCode?:string`；按dueDate过滤 | `{"orderCount":1,"completedOrderCount":0,"delayedOrderCount":0,"calculationStatus":"available","snapshotAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}` |
| POST `/api/v1/monthly-reports` | B `month:YYYY-MM,format:"pdf"`；待 Q7 | `{"fileName":"mes-2026-10.pdf","mediaType":"application/pdf","contentBase64":"<PDF内容的Base64>","dataSource":"demo","dataLabel":"演示数据"}` |

钻取通过 work-orders/tasks/reports/quality-inspections 的过滤接口；前端展示指标必须带来源及时间范围，并将 completionRate 标为累计完成率。交付订单统计按dueDate选单、按 §6.2 当前状态规则计算 completedOrderCount/delayedOrderCount；不是历史交付状态快照，不从累计完成率反推订单已完工。月报是即时导出，不返回虚构 reportId，不假设已有报告表。月报 PDF 页内必须同时注明演示数据、统计窗口、受限指标。历史月报无数据不能自动生成另一套随机数据。

### 6.9 预警中心（B10）与根因（F4）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| GET `/api/v1/alerts` | Q 分页、`type?:string,level?:预警等级,status?:预警状态,startDate?:date,endDate?:date` | `Page(Alert)` |
| GET `/api/v1/alerts/{id}` | P `id` | `Alert` |
| POST `/api/v1/alerts/{id}/state-transitions` | P `id`；B `expectedStatus:预警状态,targetStatus:预警处理状态` | `{"id":"801","status":"已确认","dataSource":"demo","dataLabel":"演示数据"}` |
| POST `/api/v1/alerts/{id}/root-cause-analyses` | P `id`；B 无 | `{"alertId":"801","possibleCauses":[{"text":"同线设备维修可能降低产能。","evidenceRefs":["device:EQP-SMT-006"]}],"suggestion":"请设备负责人检查加热区故障并反馈恢复时间。","analysisStatus":"hypothesis","mode":"local","degraded":false,"snapshotAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}` |

等级：`紧急/重要/一般`；状态：`未处理/已确认/已关闭`；预警处理状态为 `已确认/已关闭`。候选流转为未处理→已确认→已关闭；直接关闭、重开、去重周期、已关闭是否再次触发、等级映射见 Q6。预警创建是 NestJS 内部规则行为，不开放前端任意 POST alerts 或客户端自称发现预警。

本次质量阈值应用于演示 goodRate<97%，不是 FPY；**交付 completionRate<90% 规则已启用**，使用 §6.8 同一工单集合、累计 doneQty 和 planTotalQty，不能按当日产量÷当日计划另算阈值；设备状态维修中。恰好97/90不触发；无计划分母或缺日期时不比较null，须明确缺失原因。示例 doneQty=76、planTotalQty=100，累计完成率76%会触发交付预警；90/100不触发。预警、日报、问数与看板共享数字和截止时刻。规则启用是设计决策，不表示实现已运行；去重、等级和历史保存仍见 Q6。库存预警缺可用库存；停机超时、预测性延期风险规则仍不能默认启用；订单实际超期状态已按 Q1 判定。

根因依据须真实存在于当前快照。查不到关联物料批次则不能编造“该批次异常”；没有相关证据时 possibleCauses可为空并 explanation说明无法形成根因假设，不凑满 1～2 条。建议只供人工判断，不能直接执行调线。

`alert.ref_id` 是 BIGINT，但 device/material 是字符串主键，产线也没有 ID 表。设备/产线告警示例先用 refType/refId=null、content说明来源，不能将 EQP-SMT-006强转数字或谎称存在外键。结构化关联/日期快照保存方案待 Q6。

### 6.10 MRP-lite（B12，受限）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| POST `/api/v1/material-requirement-calculations` | B `orderIds:[id]`（非空去重，最多100） | `{"orderIds":["101"],"items":[{"materialCode":"<已有物料编号>","grossRequiredQty":"200.00","inboundQty":100,"availableQty":null,"shortageQty":null,"purchaseSuggestionQty":null}],"calculationScope":"flat-bom-gross-requirements","limitations":["无出库与占用流水，不能计算净缺口/采购量"],"dataSource":"demo","dataLabel":"演示数据"}` |

仅汇总 `order.qty × bom.qty` 的毛需求，不持久化采购单；缺 BOM 返回 30005，不能当作无需物料。一次只按所选订单算毛需求，不声称已扣减完工消耗。现表不支持多层父子展开、损耗/替代料、可用库存/占用/采购在途；库存预警与净采购建议受限。不得用累计入库数直接扣出“真实缺料”。

### 6.11 PWA 与开放 API（B13/B14）

B13 复用本契约：扫码工单→GET work-orders及tasks→POST reports；扫码 SN→GET sn-traces/{sn}；设备状态→POST设备state-transitions。移动端没有额外权限。离线只保留待提交输入，必须显示“未提交”；恢复网络由用户确认提交，在幂等方案确认前不得后台静默补发。

B14 仅保留候选命名，不宣称已有 ERP/MQTT/PLC 对接，不默认启用；集成身份、编号映射、事件时序与持久幂等需 Q8 确认。

| 方法 + 候选路径 | 请求参数 | 未来成功 data 示例 |
|---|---|---|
| POST `/api/v1/integrations/erp-orders` | B `source:string,externalOrderCode:string,productCode:string,qty:int,dueDate:date` | `{"orderId":"101","orderCode":"SO-20261009-001"}` |
| POST `/api/v1/integrations/device-events` | B `source:string,eventId:string,deviceCode:string,status:设备枚举,occurredAt:datetime,remark?:string` | `{"deviceCode":"EQP-SMT-006","accepted":true}` |

未启用时不注册上述路由，调用返回 HTTP404、code30001 的统一错误，不接受浏览器 JWT 或匿名设备上传。真实对接激活前须另行明确权限矩阵的集成主体行，不把 admin 人工账号等同机器账号。

## 7. AI 对外 API（全部由 NestJS 暴露）

### 7.1 智能问数（F3）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| POST `/api/v1/data-queries` | B `question:string,startDate?:date,endDate?:date,prodLine?:string` | 下列 QueryAnswer |

**QueryAnswer**：

```json
{"answerStatus":"answered","answer":"2026-10-09 SMT-3线报工良品率95.00%，为所查询产线最低（演示数据，不等同于真实FPY）。","query":{"metric":"goodRate","startDate":"2026-10-09","endDate":"2026-10-09","prodLine":null},"columns":[{"key":"prodLine","label":"产线","type":"string"},{"key":"goodRate","label":"报工良品率","type":"number","unit":"%"}],"rows":[{"prodLine":"SMT-3","goodRate":95}],"sources":[{"resource":"reports","filters":{"startDate":"2026-10-09","endDate":"2026-10-09","finalTasksOnly":true}}],"mode":"local","degraded":false,"snapshotAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

数字由 NestJS 查询结果提供；FastAPI只解读，不补数字。近7天趋势返回 rows按date升序，每天有显式状态：没有报工用 `goodRate:null,dataStatus:"no_data"`，已确认真实为0才用0。只覆盖部署的近7天（含当天），范围外返回 answerStatus no_data并解释缺失窗口，不制造历史数据。

“今天/昨天”按服务端 Asia/Shanghai；“这周”解释为本周一至今天，若与近7天窗口不符则说明可用部分，不默默把“这周”改为“近7天”。显式参数与自然语言范围冲突时返回10001要求重述；无法明确意图返回 answerStatus clarification_required及clarification文字，无推测查询。

至少覆盖：最低报工良品率产线、每天不良品数量最高日、SMT-2累计完成率7天趋势、CAL-1主要不良原因。完成率查询 rows 必须包含 `doneQty/planTotalQty/completionRate`，日计划同时返回 `planQty`，历史累计良品按 §6.8 重建；有效计划且未报工时 doneQty=0、completionRate=0，不将已知零进度误判为无数据。用户问“直通率”时答复解释当前只支持报工良品率；不良原因来自 defect.defect_type聚合，不能把生成式推断当已记录缺陷。模型无权看到未授权资源；不对外返回 SQL。

无数据示例：

```json
{"code":0,"message":"成功","data":{"answerStatus":"no_data","answer":"所查询日期没有可用生产数据。","columns":[],"rows":[],"mode":"local","degraded":false,"dataSource":"demo","dataLabel":"演示数据"}}
```

### 7.2 AI 日报（F2）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| POST `/api/v1/daily-reports` | B `date:date`；仅近7天，工厂级日报 | 下列 DailyReport |

```json
{"date":"2026-10-09","answerStatus":"answered","overview":{"planQty":14,"planTotalQty":100,"doneQty":76,"outputQty":80,"goodQty":76,"badQty":4,"completionRate":76,"goodRate":95,"isTrueFpy":false,"text":"演示数据：当日产出80件，其中良品76件；累计良品76件，计划总数100件，累计完成率76.00%。"},"linePerformance":[{"prodLine":"SMT-3","planQty":14,"planTotalQty":100,"doneQty":76,"outputQty":80,"goodQty":76,"badQty":4,"completionRate":76,"goodRate":95}],"alerts":[{"alertId":"801","type":"质量异常","title":"SMT-3良品率低于97%","possibleCauses":[],"explanation":"无足够关联证据","suggestion":"请质检员复核该时段不良类型与检验记录。","analysisStatus":"insufficient_evidence"},{"alertId":"802","type":"延期风险","title":"SMT-3累计完成率低于90%","possibleCauses":[],"explanation":"无足够关联证据；进度阈值预警不代表订单已经超期","suggestion":"请计划员核对剩余24件的后续工序计划与可用产能。","analysisStatus":"insufficient_evidence"}],"suggestions":[{"alertId":"801","text":"请质检员复核该时段不良类型与检验记录。"},{"alertId":"802","text":"请计划员核对剩余24件的后续工序计划与可用产能。"}],"mode":"local","degraded":false,"snapshotAt":"2026-10-09T09:00:00+08:00","dataSource":"demo","dataLabel":"演示数据"}
```

四段结构固定为 overview / linePerformance / alerts / suggestions。汇总数量=逐产线（含未分配）之和，goodRate按数量加权，completionRate按汇总doneQty÷汇总planTotalQty计算；不得用当日goodQty替代累计doneQty。有效计划但尚未报工时完成率为0，良品率为null；完全没有业务数据则 answerStatus=no_data，各比率null、文本解释，不编出完整日报。alerts内原因与建议使用F4同一结构化结果，包含已启用的交付<90%预警，suggestions引用alertId；示例数据满足两个阈值，因此同时展示质量和交付预警。没有预警则两数组为空，不生成与预警无关的空泛建议。

日报即时生成，不假设 reportId、历史日报表、下载链接或日报 CRUD。工厂日报不接受用户传 metrics/alerts 或任意角色。定时生成时刻、历史预警快照、可重现报告见 Q6/Q7；本版只冻结按需生成入口。LLM润色不能修改指标、引用或建议关联。

### 7.3 RAG 工艺问答（F1）

| 方法 + 路径 | 请求参数 | 返回 data 示例 |
|---|---|---|
| POST `/api/v1/rag-answers` | B `question:string,topK?:int=3`（1～5） | 下列 RagAnswer |
| GET `/api/v1/knowledge-sources` | Q 分页 | `Page({"sourceName":"02_设备清单.xlsx","chunkCount":1,"dataSource":"enterprise-documents"})`（chunkCount为形状示例，实际以knowledge.json统计） |

```json
{"answerStatus":"answered","answer":"EQP-SMT-006为回流焊炉，设备清单记载维修中，备注加热区故障。","citations":[{"sourceName":"02_设备清单.xlsx","chunkId":"<knowledge.json实际块标识>","relevance":1,"excerpt":"EQP-SMT-006…维修中…加热区故障"}],"knowledgeSource":"enterprise-documents","mode":"local","degraded":false,"latencyMs":120}
```

来源名称与 chunkId 必须来自实际知识块；relevance在0～1，表示检索相关度而非事实置信概率。EQP等编号先精确匹配对应行，不能把相似编号信息当回答。设备知识库状态与业务实时状态可能时间不同，必须说“资料记载”，不把RAG当实时设备接口。

无依据时返回：

```json
{"code":0,"message":"成功","data":{"answerStatus":"not_found","answer":"资料中没有相关信息","citations":[],"knowledgeSource":"enterprise-documents","mode":"local","degraded":false,"latencyMs":80}}
```

问题不能注入系统指令或扩大数据权限；知识库只读，不开放任意文件路径、上传或网页抓取。未配Key采用本地抽取式，配置后为mode llm；LLM失败能回退时mode local、degraded true。日志记录kind rag。

## 8. 实时、性能与兼容约定

核心主线权威数据均由HTTP获取，写入成功后的响应可以直接更新局部UI。背景的Socket.io作为可选增强：同源通道 `/api/v1/events`（复数），握手JWT交给NestJS校验；事件候选 `work-orders.changed / dashboards.changed / alerts.changed`，包体为 `{code:0,message:"成功",data:{resource,id,snapshotAt,dataSource:"demo",dataLabel:"演示数据"}}`。断线重连后重新GET数据，不把事件当持久账本。订阅规则必须遵循第5节矩阵，不给operator推经营指标，不推F4内容给manager。具体协议/刷新频率待Q10确认，不能要求前端先实现一个未确认通道。

本地模式验收目标：RAG<3秒，日报<5秒，看板<3秒。没有成功响应不得显示已提交；低于这些目标不代表可无限等待。LLM调用超时应优先使用本地模式，无法回退则用50002/50003；具体超时及限流值待部署配置确认，不由前端自行重试追加写入。

旧原型 `ai-demo` 与启动说明中的 `/ask`、`/report`、`/nl-query` 不是本契约外部路径；新版本须分别迁移为 `/api/v1/rag-answers`、`/api/v1/daily-reports`、`/api/v1/data-queries` 并经NestJS代理，不直接暴露8000给Vue3。FastAPI的 `/docs` 是开发文档入口，不是业务资源；启动说明的 `/health` 为运维检查，不替代本契约路由。

## 9. 覆盖与契约验收（设计检查清单）

| 需求 | 接口/章节 | 现表承载与验收重点 |
|---|---|---|
| B1/B2 | 6.2/6.3 | sale_order/work_order/work_task；一单一工单、WO-YYYYMMDD-三位序号、订单状态优先判定、路线缺失事务回滚、重复确认不重复工单 |
| B3 | 6.4 | report；末道良品累计、前端不指定操作者、断网不自动重发 |
| B4/B11 | 6.5 | qc_record/defect；NG自动创建明细、报工与检验不重复计数、良品率不冒充FPY |
| B5/B6 | 6.6 | material/bom/material_batch/sn_trace；只能一个快照/批次，关联工单上下文不伪装逐SN证据 |
| B7 | 6.7 | device/equipment_log；维修演示约束，OEE返回null + insufficient_data + missingInputs，前端显示缺失项说明，不再要求有数字 |
| B8 | 6.8 | NestJS同源聚合；每日计划平均分配/末日补差、累计doneQty÷计划总数、窗口产量与累计良品区分、跨工序不重复、月报受Q7限制 |
| B9 | 5 | sys_user/audit_log；JWT、三角色、日志只读、首登状态缺口待Q4 |
| B10/F4 | 6.9/4 | alert；交付累计完成率<90%启用，90%不触发、无分母不比较；三演示阈值、结构关联缺口、原因是有证据的假设 |
| B12 | 6.10 | order+bom；只算毛需求，净库存/采购量不可用 |
| B13/B14 | 6.11 | PWA复用API；开放接口仅预留、未激活不得写库 |
| F1 | 7.3 | knowledge.json + ai_query_log；精确编号、来源、无依据回答、本地/LLM降级 |
| F2/F3 | 7.1/7.2 | 同一看板/报工/检验/预警快照；日报四段、7天趋势、无数据诚实回答 |

联调时必须核对：所有HTTP成功/错误遵循包体与HTTP状态；分页空/有数据格式一致；所有路径均为/api/v1和复数资源；每个角色越权返回403；禁用用户不能沿用旧JWT访问；数字与同一报工聚合一致；演示数据和知识引用有标识；LLM未配置能演示；表结构保持18张不变。当前仅交付设计，不声明这些运行验收已经通过。

### 9.1 本次修订的设计复核记录（2026-10-09）

按第9节逐项重新审阅：B1/B2的一单一工单、编号、事务与状态说明一致；B3累计数和B4/B11良品率口径不变；B5/B6、B12仍明确单快照与毛需求限制；B7接口/驾驶舱/验收均要求OEE缺失项；B8、B10/F4、F2/F3均使用同一累计完成率并启用<90%阈值；B9角色和首登缺口、B13/B14预留边界、F1来源与降级要求保持一致。

文档静态复核覆盖：统一包体/分页、73条方法路径的/api/v1复数资源、请求与响应引用、权限矩阵覆盖、JSON示例可解析、示例算术及跨章节口径、演示标识、剩余问题未误标解决、18张表结构未改。数值用例为100件/7天分摊 `[14,14,14,14,14,14,16]`、累计76/100=76%、良品76/80=95%、交付阈值76%触发且90%不触发。此为设计验收检查，不是接口运行、JWT越权、前端显示或性能测试；实现与演示生成器由后续会话执行。

## 10. 数据库限制与待确认问题

### 10.1 已确认接受的限制

| 表结构事实 | 本版处理 | 不承诺的能力 |
|---|---|---|
| sn_trace.sn唯一，每行仅task_id/device_code/batch_id/qc_result一个值 | 返回单快照及明确标记的工单级上下文 | 每个SN完整多工序、多设备、多批次历史；逐件检验绑定；IATF合规 |
| material_batch仅qty/inbound_at，无出库/占用/调整流水 | 入库记录+毛需求计算；可用库存/缺口/采购量null | 真实库存、净MRP、安全库存自动预警闭环 |
| 无首次通过/返工/逐件流转数据 | goodRate为报工良品率、isTrueFpy=false | 真实FPY、首次合格率、质量预测 |
| sys_user只有role/post/dept，未建细权限表 | 三角色矩阵，不按岗位/车间细分 | operator按质检/仓库分权、manager本车间隔离 |
| OEE缺班次计划、设备产出与理想节拍等输入（Q3验收调整已确认） | oee=null、calculationStatus=insufficient_data、missingInputs，并显示缺失项说明 | 编造OEE数字；仅设备状态日志不能支持完整OEE |

Q1、Q5 已关闭：一单一工单、编号及订单状态见 §6.2；每日计划分摊、累计完成率及生成器约束见 §6.8，交付<90%规则见 §6.9。Q3 的 OEE 验收部分已关闭，仅保留下一节设备状态/停机阈值问题。不再重复询问这些已确认决策。

### 10.2 尚未确认；相关行为不得自行补全

| 编号 | 问题/证据 | 需要用户决定 | 对接口的影响 |
|---|---|---|---|
| Q2 | 需求主线3状态，SQL工单另有暂停/关闭；无返工/冲销表，任务seq非唯一 | 暂停/恢复/关闭允许哪些流转？任务顺序约束？完工以良品达计划还是人工确认？超计划/返工怎么处理？设备分配条件？ | 状态机、自动完工、超量报工、task分配规则待确认；doneQty口径已确认，不重复询问 |
| Q3（剩余） | 没有设备允许迁移表与停机阈值；OEE缺失项验收已确认 | 设备允许流转表、停机超时阈值是什么？ | 仅停机超时告警及设备状态迁移待确认；OEE按 §6.7 返回缺失项，不再要求数字 |
| Q4 | 无首登改密、refresh/session/revocation字段；不能假装有这些列 | 首登状态、会话刷新/吊销是否允许使用现有audit_log.detail或独立配置/缓存？JWT有效期/算法、密码策略、改密后令牌失效范围怎么定？ | 仅冻结JWT基本认证/改密入口；首登限权、自动刷新、即时退出不能当已完成 |
| Q6 | alert.ref_id是BIGINT，设备/物料code是字符串；无规则key、日期/证据快照、处理人列 | 是否允许在alert.content中约定版本化JSON保存关联code、规则key、日期、指标与分析快照（仍限512字符），不足时如何处理？去重窗口、等级映射、关闭/重触发规则怎样定？ | 不可默认用remark/content塞任意JSON；日期日报历史预警与F4一致性持久方案待确认；处理人通过audit_log记录 |
| Q7 | 无报告表或历史快照；SN真实链路受限，要求导出格式未完整明确 | 追溯JSON是否足够，还是必须PDF？月报PDF内容模板/单位/窗口？日报只即时生成还是需持久历史/定时任务，时间与存储位置是什么？ | JSON追溯保留限制；月报格式/定时日报/历史重现待确认，不冒充合规交付 |
| Q8 | 无ERP外部单号、设备eventId唯一键/集成账号表；MQTT/PLC明确不做 | 本版是否仅预留路径？未来集成身份、外部编号存储、乱序事件/幂等策略怎么定？ | B14不启用；不会增加字段或默认接收机器上传 |
| Q9 | report/qc_record没有客户端提交唯一键；批次只能按batch_no去重 | 追加提交是否接受“禁止自动重试、人工核查”，或允许在audit_log.detail/缓存中设计Idempotency-Key去重与持久恢复？缓存失效/跨实例并发怎么处理？ | 本稿采用禁止自动重试作为边界，不宣称Exactly-once；稳定离线补发/持久幂等仍待批准 |
| Q10 | 背景推荐Redis/Socket.io，用户冻结栈未要求它们必选 | 本版是否启用Redis和Socket.io？若只用HTTP，允许的看板刷新周期？Socket.io握手/路径/权限、订阅方式怎么定？ | 本稿实时通道只是候选；不自动增加必需服务/协议 |

补充明确：仅2产品有BOM、仅部分产品有详细路线，不能因为主数据有15产品就声称全部可自动分解/算料；缺明细一律返回30005。BOM无版本/父子边，work_task设备/用户、report用户、QC任务/检验人、SN多个关联字段缺SQL外键，服务端必须校验。ai_query_log可存摘要，不是结构化日报/根因报告存储表。

以上问题先提出，不修改 `db/schema.sql`。用户确认后仅修订受影响契约；实施会话必须先解决对应待确认项，不自行造字段、造历史数据或造业务规则。
