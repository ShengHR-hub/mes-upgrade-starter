# 交接文档 — S3 FastAPI AI 服务 — 2026-10-10

> **状态：已完成 → 二轮（审查 9 项 + 7 决策）→ 三轮（补测 8 项）→ 四轮（复审 8 项 + 凭据规则）→ 五轮（复审 3 项）→ 六轮（复审 2 项）→ 七轮（复审 1 项）→ 八轮（复审 2 项，含七轮回归修正），逐项实测通过（2026-10-10），待复审。**
> 落点：`mes-upgrade-starter/ai-service/`，端口 **8000**（绑定 `127.0.0.1`）。
> 复用 `ai-demo/` 的 `rag.py` / `knowledge.json`；⚠️ **`rag.py` 已派生修改**（见 §8）；**`daily_report.py` 已删除**（见 §8.3）；
> **`knowledge.json` 已脱敏**（移除 23 处明文初始口令，见 §11.3）；**两份人员账号表亦已脱敏**（见 §12.1）。
> **全部配置只认进程环境变量**（已移除 python-dotenv 与 `.env`，见 §11.1）；**未改表结构、未碰业务库**；权限由 NestJS 校验。
> 环境：Python **3.13.14**；FastAPI **0.143.0** / uvicorn **0.54.0** / pydantic **2.14.0** / starlette **1.7.0**。
> **§8 二轮 · §9 令牌注入 · §10 三轮 · §11 四轮 · §12 五轮 · §13 六轮 · §14 七轮 · §15 八轮（复审）**

---

## 1. 本会话做了什么

在 `mes-upgrade-starter/ai-service/` 用 FastAPI 建成 AI 服务：复用 `ai-demo` 的检索逻辑，
在其上实现契约 §4.1 的 **5 个内部接口**（`rag-answers` / `query-intents` / `query-answers` /
`root-cause-analyses` / `daily-reports`）与 **`GET /api/v1/health`**（另暴露 `/health` 运维别名，与 S2 口径一致）。

统一实现契约 §2 的返回包体 `{code,message,data}` 与 §3 错误码（10001/20001/30001/50001…）；
内部接口用 **服务令牌** `Authorization: Bearer <AI_SERVICE_TOKEN>` 认证（**不接受普通用户 JWT**），
令牌与 LLM 密钥只从环境变量读、不进日志不进返回；未配置 LLM 时全程 **本地模式**（`mode:"local"`）可用。

**RAG 5 个预设问题全部命中且带引用来源**（见 §4.3，第二轮复测见 §8.6）。

> 第二轮（本轮）按审查报告做了 9 项修复 + 7 项口径落实：日报改为**原样透传** NestJS 快照、
> RAG 编号 **token 级精确匹配**、意图解析**精确日期/组合矩阵/澄清**、根因**四字段证据且不补造事实**、
> 严格嵌套校验、模型调用**异步隔离+超时回退**、问数文本**分维度输出**、**usage 透传**。

---

## 2. 文件清单

### 新增（`mes-upgrade-starter/ai-service/`）

| 文件 | 行数 | 作用 |
|---|---|---|
| `main.py` | 1406 | 服务主体：6 个路由、统一包体/错误码、服务令牌认证、`X-Request-Id`、严格请求模型与业务逻辑 |
| `rag.py` | 232 | **派生复用**：源自 `ai-demo/rag.py`，按 P2-7/P2-9 增加 `chat_full()`（超时可配 + usage 透传）与 `extractive_answer()`；检索算法未改 |
| `knowledge.json` | 31 块 | **复用**：从 `ai-demo/knowledge.json` 复制，MD5 `21d19a31e8a7becd1903cb0de3ca72e1`（与源一致） |
| `requirements.txt` | 3 | `fastapi` / `uvicorn[standard]` / `python-dotenv` |
| `.env.example` | — | 环境变量模板（`AI_SERVICE_TOKEN`、`AI_BASE_URL/AI_API_KEY/AI_MODEL`、`AI_TIMEOUT_SECONDS`、`AI_RATE_LIMIT_PER_MINUTE`） |
| `.gitignore` | — | 排除 `.venv/`、`__pycache__/`、`.env`、`*.log` |
| `.venv/` | — | 项目本地虚拟环境（**已 gitignore，不入库**） |

### 删除（第二轮）

| 文件 | 原因 |
|---|---|
| `daily_report.py` | **P1-1**：日报接口改为纯透传 NestJS 快照后已无任何引用；离线演示按审查要求只保留在 `ai-demo/`。原件仍在 `ai-demo/daily_report.py`（未改动） |

### 新增（文档）

- `docs/handovers/s3-ai-service.md`（本文件）

### 未改动

`db/schema.sql`、`db/seed.sql`、`data/*.xlsx`、`docs/api-contract.md`、`backend/**`、`ai-demo/**`。

---

## 3. 接口清单

全部 POST，`/api/v1` 前缀，统一包体；除健康检查外均需服务令牌。

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/v1/ai/rag-answers` | RAG 工艺问答：复用 `rag.py` + `knowledge.json`，返回 `answer/citations/mode` | 服务令牌 |
| POST | `/api/v1/ai/query-intents` | 自然语言意图解析（**本地规则，不调 LLM**）；越界返回 `supported:false` | 服务令牌 |
| POST | `/api/v1/ai/query-answers` | 依据 NestJS 传入的 `queryResult` 组织自然语言回答（**只转述数字**） | 服务令牌 |
| POST | `/api/v1/ai/root-cause-analyses` | 依据 `alert`+`evidence` 生成 `possibleCauses`（含 `evidenceRefs`）+ `suggestion` | 服务令牌 |
| POST | `/api/v1/ai/daily-reports` | 依据 `metrics`+`alerts` 生成四段日报；**汇总数 = 各产线之和** | 服务令牌 |
| GET | `/api/v1/health`、`/health` | 运维健康检查（服务状态、知识块数、LLM 配置、令牌配置） | 公开 |

`GET /docs`（Swagger UI）与 `/openapi.json` 由 FastAPI 自带；实测 `/openapi.json` 恰好注册上述 6 条业务路径。

---

## 4. 自测结果

环境：**pwsh 7.6.6** 未用于本模块（纯 Python/HTTP）；HTTP 用原生 `curl`；服务以 uvicorn 启动于 `127.0.0.1:8000`。

### 4.1 安装与启动

```powershell
# 1) 建 venv（用本机 managed Python 3.13）
cd mes-upgrade-starter\ai-service
C:\Users\盛浩然\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe -m venv .venv

# 2) 装依赖（⚠️ 不要加 `--upgrade pip`：升级 pip 会触发沙箱批量删除保护而失败；本环境无需升级）
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 3) 配置令牌（写入 .env 或临时环境变量；口令不入库）
$env:AI_SERVICE_TOKEN = "<你的服务令牌>"

# 4) 启动
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000 --host 127.0.0.1
# 或（venv 已激活时）：
# uvicorn main:app --port 8000
```

实测依赖版本：`fastapi 0.143.0`、`uvicorn 0.54.0`、`pydantic 2.14.0`、`starlette 1.7.0`、`python-dotenv 1.2.4`。

### 4.2 逐接口实测摘要（原生 curl，节选）

| # | 请求 | 结果 |
|---|---|---|
| 1 | `GET /api/v1/health` | **200** `{"code":0,…"data":{"status":"ok","service":"mes-ai-service","version":"0.1.0","knowledge":{"chunks":31},"llm":{"configured":false,"mode":"local"},"auth":{"serviceTokenConfigured":true}}}` |
| 2 | `GET /health` | **200**（运维别名，同上） |
| 3 | `GET /docs` | **200** `text/html`（接口文档页可打开） |
| 4 | 无令牌 POST `rag-answers` | **401 / 20001** `{"code":20001,"message":"缺少服务令牌（Authorization: Bearer <AI_SERVICE_TOKEN>）","data":null}` |
| 5 | 错误令牌 | **401 / 20001** `"服务令牌无效"` |
| 6 | 未知字段 `{"question":"x","bogus":1}` | **400 / 10001** `data.errors=[{"field":"bogus","reason":"未知字段，请求被拒绝"}]` |
| 7 | 未知路径 `/api/v1/nope` | **404 / 30001** `{"code":30001,"message":"资源不存在","data":null}` |
| 8 | 响应头 | 每个响应均带 `X-Request-Id`（合法入参沿用，否则生成 UUID） |
| 9 | `topK=6`（超 1~5） | **400 / 10001** `reason:"数值超出允许范围，需 ≤ 5"` |
| 10 | `question=""` | **400 / 10001** `reason:"长度不足，至少需要 1 个字符"` |
| 11 | 5 接口 happy-path 回归 | 全部 **200**（`rag-answers`/`query-intents`/`query-answers`/`root-cause-analyses`/`daily-reports`） |

**意图解析实测（6 例，全部符合契约白名单）：**

| 问题 | 结果 |
|---|---|
| `SMT-3线报工良品率最低的产线是哪个？` | `supported:true` `{metric:goodRate, groupBy:prodLine, operation:minimum, prodLine:"SMT-3"}` |
| `SMT-2累计完成率7天趋势` | `{completionRate, date, trend, startDate:2026-10-03, endDate:2026-10-09}` |
| `每天不良品数量最高的是哪天？` | `{badQty, date, maximum}` |
| `CAL-1线主要不良原因是什么？` | `{defectQty, defectType, list, prodLine:"CAL-1"}` |
| `各设备状态怎么样？` | `{deviceStatus, device, list}` |
| `现在仓库还剩多少库存？`（超纲） | `supported:false`，`reason:"无法从问题中识别出受支持的指标（metric）。"` |

**问数文本实测：** `queryResult.rows=[{SMT-3:95},{SMT-1:98.5},{CAL-1:97.2}]` + 问题含"最低"
→ `answer:"SMT-3 报工良品率 95%，为所查询范围最低。"`（**只转述入参数字，未新增**）；
`rows=[]` → `answerStatus:"no_data"`，`answer:"所查询日期没有可用生产数据。"`。

**根因实测：** 有证据（device + quality）→ `possibleCauses` 2 条，各带 `evidenceRefs`（`device:EQP-SMT-006`、`defect-type:…`），
`analysisStatus:"hypothesis"`；**无证据 → `possibleCauses:[]` + `explanation:"未提供关联证据，无法形成根因假设。"`**（不凑条数）。

**日报实测：** 传 2 条产线（SMT-3 / SMT-1）→ 汇总 `planTotalQty=150, doneQty=96, outputQty=102`，
`completionRate=64.0`（=96/150，**不是**两线比率平均）、`goodRate=94.12`（=96/102，按数量加权）；
四段 `overview/overviewText/linePerformance/alerts/suggestions` 齐全，`suggestions` 逐条带 `alertId`。

> ⚠️ **第六轮已改**：`suggestions` 现为**字符串数组**（契约 §4.1），不再带 `alertId`；见 §13.2。
`metrics` 缺失且未传 `demo:true` → **400 / 10001**（`metrics 为必填`）。

### 4.3 RAG 5 个预设问题（验收点 F1，全部带引用来源）

| # | 问题 | 结果 | 引用来源（sourceName / chunkId / relevance） |
|---|---|---|---|
| ① | 公司核心痛点是什么？ | answered | `需求背景文档·七大痛点总览` / `kb-030` / 0.267（另 `痛点3` kb-010、`痛点2` kb-009） |
| ② | JC-PLC-2001有哪些工序？ | answered | `企业数据·工艺路线总览` / `kb-028` / 0.374（另 `JC-PLC-2001工序详情` kb-029、`BOM清单·JC-PLC-2001` kb-026） |
| ③ | EQP-SMT-006现在是什么状态？ | answered | `企业数据·设备清单` / `kb-018` / 0.55，**摘要精确到该编号行**：`设备编号：EQP-SMT-006；…设备状态：维修中；…备注：加热区故障` |
| ④ | MES系统有哪九大功能模块？ | answered | `需求背景文档·九大功能需求总览` / `kb-031` / 0.489（另 `2.2 角色映射` kb-004） |
| ⑤ | SN追溯解决什么问题？ | answered | `需求背景文档·痛点3：质量追溯困难` / `kb-010` / 0.214（另 `痛点5：物料批次追溯缺失` kb-012） |

答案正文直接取自 `rag.ask()`（本地抽取式，`mode:"local"`），延迟 6–12ms（契约本地目标 RAG<3s，实测远低于）。

---

## 5. 已知问题 / 待办

### 5.1 需要确认的口径（本会话采取的解读，请审查/总控确认）

> ⚠️ **本轮（第二轮）已按审查裁决全部落实**：意图组合矩阵、chunkId 临时口径、mode 映射、
> 服务令牌 fail-closed、`demo` 字段、evidence DTO、超时/限流 均已定案 —— **以 §8.3 为准**，
> 下列条目保留为第一轮原始记录（其中 `demo:true` 已删除、组合矩阵已替换为 `_is_allowed_combo()`）。

- [ ] **意图组合矩阵**：契约 §4.1 只给出 `metric/groupBy/operation` **三个白名单**，未给显式"合法组合表"。
  本会话按**三白名单的笛卡尔积**实现（任一取值越界即 `supported:false`）。
  若需排除语义不通的组合（如 `deviceStatus × defectType`），请给出组合矩阵，改动点集中在 `main.py` 的
  `ALLOWED_METRICS/ALLOWED_GROUPS/ALLOWED_OPS` 三处。
- [ ] **chunkId 来源**：`knowledge.json` **没有 `chunkId` 字段**（仅 `source` + `text`）。
  本会话按文档顺序合成稳定标识 `kb-001…kb-031`（可复现，非随机）。若后续重建知识库需保留稳定 chunkId，
  建议在 `build_kb.py` 产出时写入，届时替换 `main.py` 的 `_CHUNK_ID_BY_KEY` 映射。
- [ ] **`mode` 取值映射**：`rag.py` 原始返回 `mock:extractive` / `llm:<model>` / `none`；
  契约 §3/§7.3 要求 `local` / `llm`。本会话映射为：`llm* → "llm"`，`mock* → "local"`，无命中 → `answerStatus:"not_found"`、`mode:"local"`。
- [ ] **服务令牌未配置时 fail-closed**：`AI_SERVICE_TOKEN` 为空时，内部接口一律 **401/20001**（"服务令牌未配置"），
  不静默放行。若希望"未配置即可匿名调用"用于本地联调，请明确，否则保持现状。
- [ ] **`daily-reports` 的 `demo:true` 扩展字段**（**非契约字段**）：契约 §4.1 要求入参含 `metrics`（看板 DTO）。
  为便于**无 NestJS 时离线联调**，本会话增加可选布尔 `demo`：传 `demo:true` 且未传 `metrics` 时，
  走 `daily_report.gen_demo_day()` + `render()` 的固定种子演示路径（结果标 `dataSource:"demo"`、附 `markdown`）；
  正常契约路径（传 `metrics`）**不启用**该分支。如认为不该有此扩展，删除 `DailyReportRequest.demo` 与 `_demo_daily_report()` 即可。
- [ ] **`root-cause-analyses` 的 `evidence` 形状**：契约只写"已授权关联数据数组"，未定元素结构。
  本会话按 `type/kind` 归类，`ref|evidenceRef|refId|id|key` 或 `type:code` 作为 `evidenceRefs`，
  文本只引用证据中**实际存在**的字段（设备编号/状态、不良类型、批次号、完成率），不编造。

### 5.2 未实测 / 未覆盖

- [ ] **LLM 路径未实测**：本机未配置 `AI_BASE_URL/AI_API_KEY/AI_MODEL`，故**只实测了本地模式**。
  `mode:"llm"` 与"LLM 失败回退本地（`degraded:true`）"为**代码级实现**（`main.py` `rag_answers()` 的
  `try/except` + `_ask_local()` 临时清空环境变量强制本地），**未做故障注入实测**。配好密钥后请补测。
- [ ] `usage.tokensIn/tokensOut` **恒为 0**：`ai-demo` 的 LLM 客户端未回传 usage，本地模式亦无 token 计量。
- [ ] **未实现限流**：契约 40001（RATE_LIMITED）已定义但未启用（本版无并发/频率限制）。
- [ ] **未启用 CORS**：契约 §2.1 要求经 NestJS 同源代理访问，故不开放跨域。
- [ ] **未持久化**：不写 `ai_query_log`（属 NestJS 职责，见契约 §4.1）。

### 5.3 环境坑（后续会话必读）

- [ ] **不要执行 `pip install --upgrade pip`**：会触发沙箱的批量删除保护
  （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），导致升级失败并在 `site-packages` 留下 `~ip` / `~ip-26.1.2.dist-info` 残留。
  残留仅让 pip 打印 `Ignoring invalid distribution ~ip` 警告，**不影响运行**；若需消除，重建 venv 即可（不要删 `.venv` 目录，会同样触发保护）。
- [ ] 服务**绑定 `127.0.0.1`**（不绑 `0.0.0.0`），符合"8000 不直接暴露给浏览器"的约束；S8/S9 由 NestJS 代理。
- [ ] 本机 5 个 MySQL 实例与本服务无关：**本服务不连任何数据库**。

---

## 6. 给下个会话的提示

1. **S9（F3 智能问数 + F1 RAG 接入前端）**：NestJS 侧调用链路为
   `POST /api/v1/data-queries` →（内部）`POST http://127.0.0.1:8000/api/v1/ai/query-intents` 取意图 →
   NestJS 按白名单做受控查询 →（内部）`POST …/ai/query-answers` 组织文本；
   RAG 走 `POST /api/v1/rag-answers`。**内部调用必须带 `Authorization: Bearer <AI_SERVICE_TOKEN>`**。
2. **S8（F2 AI 日报 + F4 预警根因）**：`…/ai/root-cause-analyses`（传 `alert` + 授权后的 `evidence`）、
   `…/ai/daily-reports`（传看板 `metrics` + 含根因的 `alerts`）。
3. **先看这几个文件**：`docs/api-contract.md` §2/§3/§4.1/§7、本文件、`ai-service/main.py`（§"接口模型"与各 handler）、
   `ai-service/.env.example`。
4. **内部接口返回结构**（供 NestJS 组装外部 DTO）：
   - `rag-answers` → `{answerStatus, answer, citations[{sourceName,chunkId,relevance,excerpt}], knowledgeSource, mode, degraded, usage{tokensIn,tokensOut}, latencyMs}`
   - `query-intents` → `{supported, intent{metric,groupBy,startDate,endDate,prodLine,operation} | reason[, clarificationRequired], usage, latencyMs}`
   - `query-answers` → `{answerStatus, answer, mode, degraded, usage, latencyMs}`
   - `root-cause-analyses` → `{possibleCauses[{text,evidenceRefs}], suggestion, analysisStatus, [explanation], mode, degraded, usage, latencyMs}`
   - `daily-reports` → `{answerStatus, date, overview{…原样透传…}, overviewText, linePerformance[], alerts[], suggestions[string], dataSource, dataLabel, mode, degraded, usage, latencyMs, snapshotAt}`
     （**`suggestions` 为字符串数组**，契约 §4.1；`{alertId,text}` 关联对象由公开日报 DTO 层组装，见 §13.2）
5. **日报口径（第二轮已改）**：`overview` 与 `linePerformance` **原样透传** NestJS 传入的权威快照，
   **不再自行汇总/改数**（保留 `null` 与 `calculationStatus`）；若顶层 `metrics.metrics` 与各产线之和不一致 → 返回 **10001** 并列出差异字段，
   不静默改数。空业务数据 → `answerStatus:"no_data"`。
6. **入参必填**：5 个内部接口都要求 `userContext{userId,role}` 与 `requestId`；嵌套对象一律 `extra=forbid`（未知字段 10001）。
   `daily-reports.metrics` 为必填，且需含 `metrics`（权威汇总）子对象；`evidence` 必须是 `{type,resourceId,ref,fact}` 四字段。
7. **服务令牌**：NestJS 侧 `.env` 与本服务 `.env` 的 `AI_SERVICE_TOKEN` 必须一致；令牌只走环境变量，不入 DTO、日志、响应。
   未配置令牌时内部接口 **fail-closed**（401/20001）；联调用临时环境变量令牌，**不开放匿名**（决策 4）。

---

## 8. 第二轮修复记录（审查报告 9 项 + 待决策 7 项）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。
> 所有验证均用审查报告给出的**反例**复现（修复前行为 → 修复后行为），另做全量回归。

### 8.1 P1 逐项修复说明（文件 + 行号 + 改了什么）

| 编号 | 文件:行 | 改了什么 |
|---|---|---|
| **P1-1** 删除 demo 分支 | `main.py:1179-1195`（`daily_reports`）、`main.py:436-448`（`DailyReportRequest`） | 删除 `demo: bool` 字段、`_demo_daily_report()` 函数与 `elif body.demo` 分支；`metrics` 由 `Optional` 改为**必填**。`daily_report.py` 因无引用一并删除 |
| **P1-2** 日报不改写数字 | `main.py:1116-1177`（`_assemble_daily_report`）、`main.py:1099-1114`（`_check_consistency`） | `overview = dict(agg)`、`linePerformance = [dict(ln) …]` **原样透传**；不再由产线求和改写；新增一致性校验：顶层与各产线之和可比且不等 → **10001** 列出差异字段；`answerStatus` 依据 `calculationStatus=="no_data"` 或关键指标全 `null` → `no_data` |
| **P1-3** RAG 编号精确匹配 | `main.py:149-171`（`_CODE_TOKEN_RE`/`_code_tokens`/`_line_with_codes`）、`main.py:601-680`（`rag_answers`）、`main.py:646-658`（`_code_answer`） | 编号改为 **token 级**完整匹配（正则 `[A-Z]{2,}-[A-Z0-9\-]+`）；问题含编号但无对应知识块 → `answerStatus:"not_found"`、`citations:[]`；设备类回答强制「**根据企业资料记载…不代表设备实时状态**」；编号类问题走确定性引用，`mode:"local"` |
| **P1-4** 意图不改查询范围 | `main.py:730-800`（`_parse_dates`）、`main.py:803-820`（`_is_allowed_combo`）、`main.py:823-873`（`query_intents`） | 显式日期（ISO / `2026年10月1日`）精确解析、多日表述取区间；无法确定（`上个月/本月/今年…`）→ `supported:false` + **`clarificationRequired:true`**，不猜测；引入**合法组合矩阵**（非笛卡尔积，见 §8.2 决策 1） |
| **P1-5** 根因不补造事实 | `main.py:980-1076`（根因整段）、`main.py:430-440`（`EvidenceItem`） | `evidence` 强制 `{type,resourceId,ref,fact}` **四字段必填**（`extra=forbid`）；原因文本**只引用 fact/resourceId**，不再由缺失字段推出「状态异常」；`evidenceRefs` 直接取 `ref`（可定位）；证据不足 → `analysisStatus:"insufficient_evidence"` + `explanation` |

### 8.2 P2 逐项修复说明

| 编号 | 文件:行 | 改了什么 |
|---|---|---|
| **P2-6** 请求校验补齐 | `main.py:301-535`（请求模型整段）、`main.py:255-268`（校验错误翻译） | 新增 `StrictModel(extra="forbid")` 与严格嵌套 DTO（`UserContext`/`DateContext`/`EvidenceItem`/`AlertItem`/`QueryResultDTO`/`DashboardDTO`…）；`userContext`+`requestId` 改必填；`topK` 用 `strict=True`（拒绝 `true`）；`date`/`dateContext.today` 增加真实日历日校验；`rows` 声明为 `List[Dict]`（非对象元素 → 10001 而非 500）；新增 `_validate_nested()` 把嵌套校验失败统一转 10001 |
| **P2-7** 模型异步隔离 + 空回答降级 | `rag.py:71-146`（`LLMClient`/`llm_timeout`）、`main.py:660-680`（`rag_answers`） | `rag.py` 新增 `llm_timeout()`（`AI_TIMEOUT_SECONDS`，默认 **2 秒**），`urlopen(timeout=self.timeout)`；服务层改用 `await asyncio.wait_for(asyncio.to_thread(rag.ask, …))` **移出事件循环**；超时/异常/空文本一律回退 `rag.extractive_answer()`，`mode:"local"` + `degraded:true` |
| **P2-8** 问数文本修正 | `main.py:876-955`（`_classify_columns`/`_build_query_answer`） | 列按「维度 / 辅助数量 / 辅助比率」三类分开输出（维度用 `，` 连接、辅助量放括号），消除 `SMT-27610014` 式拼接；问「直通率」时明确「仅支持报工良品率、不支持真实直通率(FPY)」；`goodRate` 追加「不等同于真实 FPY」，`completionRate` 追加口径说明 |
| **P2-9** 透传模型用量 | `rag.py:112-140`（`chat_full` 读取 `usage`）、`main.py:660-680` | `chat_full()` 如实读取供应商 `usage.prompt_tokens/completion_tokens`；`ask()` 返回 `usage`；服务层 `usage = result["usage"]` 透传（本地/回退路径为 0/0） |

### 8.3 7 项待决策口径落实情况

| # | 口径 | 落实 |
|---|---|---|
| 1 | 意图合法组合（非笛卡尔积） | `_is_allowed_combo()`：`deviceStatus` **仅** `groupBy=device + operation=list`；`trend` **仅** `groupBy=date`；`minimum/maximum` 需 `prodLine/date/device` 可比维度；其余按受控查询能力开放。四个 F3 示例均覆盖 |
| 2 | chunkId | 仍为顺序编号 `kb-001…031`，**仅作本版固定知识库的临时兼容**；`_CHUNK_ID_BY_KEY` 单点映射，后续 `build_kb.py` 写入持久 ID 时替换此处即可 |
| 3 | mode 映射 | `mode` 反映**实际执行路径**：编号类 RAG 与问数文本为确定性组装 → `local`（不照抄入参 `mode`）；仅当真的调用模型且返回非空 → `llm` |
| 4 | 未配置服务令牌 | 保持 **fail-closed**（401/20001），联调走临时环境变量令牌，不开放匿名 |
| 5 | `demo:true` | **已删除**（见 P1-1） |
| 6 | evidence DTO | `{type,resourceId,ref,fact}` 四字段必填，禁止猜引用（见 P1-5） |
| 7 | 超时限流 | 本地模式为验收基线；模型调用已异步隔离 + 超时可配（默认 2 秒）；限流**占位**：`AI_RATE_LIMIT_PER_MINUTE` 登记并在 `/health.rateLimit` 回显，`enforced:false`（首版不启用） |

### 8.4 P1 反例复现（修复前 → 修复后）

| # | 反例 | 修复前 | 修复后（实测） |
|---|---|---|---|
| 1a | `daily-reports` 不带 `metrics` | 走 demo 分支自行造数（完成率 94%，实际 91.98%） | **400/10001** `{"field":"metrics","reason":"必填字段缺失"}` |
| 1b | `daily-reports` 传 `demo:true` | 生成演示数据 | **400/10001**（`metrics` 必填 + `demo` 未知字段） |
| 2a | 顶层 `goodQty=77`、各产线之和 76 | 被静默改成 76 | **400/10001** `顶层汇总(77) 与各产线之和(76) 不一致…不自行改数` |
| 2b | `doneQty:null` | 被转成 `0` | **原样保留 `null`**；`calculationStatus:"insufficient_data"` 与 `missingInputs` 一并保留 |
| 2c | 明确 `no_data` 的空样例 | 返回 `answered` | **`answerStatus:"no_data"`**，文案含 `calculationStatus=no_data` |
| 3a | 问 `EQP-SMT-999` | 返回其他设备（EQP-SMT-001） | **`not_found`**、`citations:[]` |
| 3b | 问 `EQP-SMT-00` | 命中 `EQP-SMT-001` | **`not_found`**（token 级匹配，不当作 001） |
| 3c | 问 `EQP-SMT-006` | 未注明"资料记载" | **`根据企业资料记载（企业数据·设备清单）：…设备状态：维修中…说明：以上为知识库资料记载，不代表设备实时状态。`** |
| 4a | 「2026-10-01 的产量」 | 解析成 2026-10-10 | `startDate=endDate=**2026-10-01**` |
| 4b | 「昨天和今天」 | 只剩昨天 | `2026-10-09 ~ **2026-10-10**`（两天范围） |
| 4c | `deviceStatus + maximum` | `supported:true` | **`supported:false`**，`reason` 说明组合不支持 |
| 4d | 「上个月的产量」 | 静默按今天解析 | **`supported:false` + `clarificationRequired:true`** |
| 5a | 空 `evidence` | 产生原因 + 不可定位引用 | **`analysisStatus:"insufficient_evidence"`** + `explanation`，`possibleCauses:[]` |
| 5b | `evidence:[{}]` | 产生原因 | **400/10001**（缺 `type/resourceId/ref/fact` 四字段） |
| 5c | 只传设备编号不传状态 | 输出「状态异常」 | 只陈述 `fact`：`设备 EQP-SMT-006 的资料记载：设备在设备清单中存在。可能影响相关产线产能。` |

### 8.5 P2 复现与回归

| 项 | 实测 |
|---|---|
| P2-6a 缺 `userContext` | 400/10001 `必填字段缺失` |
| P2-6b 缺 `requestId` | 400/10001 `必填字段缺失` |
| P2-6c `userContext` 未知字段 | 400/10001 `userContext.zzz 未知字段，请求被拒绝` |
| P2-6d `topK=true` | 400/10001 `必须为整数`（不再当 1） |
| P2-6e `date=2026-13-45` | 400/10001 `日期不是有效日历日` |
| P2-6f `dateContext.today=2026-99-99` | 400/10001 |
| P2-6g `rows:["not-an-object"]` | **400/10001** `queryResult.rows.0 必须为对象`（不再 500） |
| P2-6h `metrics.metrics.bogus` | 400/10001 未知字段 |
| P2-7a 慢调用（假模型 sleep 3s / 服务超时 1s） | `mode:"local"`、`degraded:true`、`latencyMs≈1016`（约 1s 即回退） |
| P2-7b 空文本回答 | `mode:"local"`、`degraded:true` |
| P2-7c 异步隔离 | 慢调用进行中连打 3 次 `/api/v1/health` → 均 **200**，`time_total` 0.017/0.003/0.003s（未阻塞） |
| P2-8a 完成率（4 列） | `产线 SMT-2 累计完成率 76%（计划总数 100，累计良品 76）`（无拼接、维度/数量/比率分开） |
| P2-8b 问「直通率」 | `…报工良品率 95%，为所查询范围最低。（说明：当前系统只支持「报工良品率」，不支持真实直通率（FPY）；报工良品率不等同于真实 FPY。）` |
| P2-9 正常模型调用 | `mode:"llm"`、`usage:{tokensIn:17,tokensOut:9}`（与假供应商返回一致） |

> **模型路径的实测方式**：本机无真实密钥，故用**临时**假 LLM（OpenAI 兼容 `/chat/completions`，本地 8099）
> 完成 P2-7/P2-9 验证，跑完即删除该临时脚本并关闭端口（8099 已释放）。
> `AI_TIMEOUT_SECONDS=1` 用于放大超时行为；**默认值为 2 秒**（见 `.env.example`）。

### 8.6 回归测试（确认无退化）

| 项 | 结果 |
|---|---|
| 5 接口 happy-path（带齐 `userContext`/`requestId`） | 全部 **200** |
| 认证：无令牌 / 错误令牌 | **401/20001** |
| 未知路径 | **404/30001** |
| 未知顶层字段 | **400/10001** |
| `/api/v1/health`、`/health`、`/docs` | **200** |
| 统一包体 `{code,message,data}` | 全部响应一致（含错误） |
| `X-Request-Id` | 每响应均带 |
| **RAG 5 个预设问题**（本地模式复跑） | 全部 `answered`，引用不变：① `kb-030` ② `kb-028`（含 `kb-029`/`kb-026`）③ `kb-018` ④ `kb-031` ⑤ `kb-010` |
| 超时回退本地 | 见 P2-7a |

### 8.7 本轮新增/变更文件

- **修改**：`ai-service/main.py`（944 → 1235 行）、`ai-service/rag.py`（179 → 232 行）、`ai-service/.env.example`
- **删除**：`ai-service/daily_report.py`（无引用；`ai-demo/daily_report.py` 未改动）
- **未改动**：`db/schema.sql`、`db/seed.sql`、`data/*.xlsx`、`docs/api-contract.md`、`ai-demo/**`、`backend/**`

### 8.8 遗留 / 需复审确认

- [ ] **日报一致性策略**：顶层 `metrics.metrics` 与 `ΣlinePerformance` 不一致时，本版选择**返回 10001 报错**
      （审查原文为"返回错误/说明异常"）。若希望改为"成功返回 + 附一致性告警"，改动点集中在 `_check_consistency()`。
- [ ] **`daily_report.py` 删除**：依据 P1-1「离线演示…不进 ai-service」执行；如需保留该副本（仅作参考），可随时从 `ai-demo/` 恢复。
- [ ] **chunkId** 仍为顺序编号（决策 2 明确为"临时兼容"），待 `build_kb.py` 产出持久 ID 后替换。
- [ ] **限流未启用**（决策 7 为"占位"）：仅登记配置位，`/health.rateLimit.enforced=false`。
- [ ] **未持久化** `ai_query_log`（属 NestJS 职责）。
- [ ] 真实 LLM 供应商下的 `usage` 字段名若与 OpenAI 不同（如 `input_tokens`），需在 `rag.py:chat_full()` 补充映射。

---

## 9. 服务令牌的注入方式（**密钥不落盘**，第三轮 P8 已修正）

> ⚠️ 本节已于第三轮按补测报告 P8 重写：**令牌不再从 `.env` 读取，也不写入任何文件**。
> 原第二轮曾把令牌落到 `ai-service/.env`，该做法已废弃并已清除（`grep AI_SERVICE_TOKEN .env` = 0 命中）。

**唯一来源：进程环境变量 `AI_SERVICE_TOKEN`**（`ai-service/main.py`）：

| 项 | 位置/说明 |
|---|---|
| 读取代码 | `main.py` `_PROCESS_ENV = dict(os.environ)`（**在 `load_dotenv` 之前**捕获）+ `AI_SERVICE_TOKEN = _PROCESS_ENV.get("AI_SERVICE_TOKEN", "").strip()` |
| 为何在 dotenv 之前捕获 | 保证即使 `.env` 里出现同名键也无法注入令牌 —— 令牌只认进程环境 |
| 未注入时行为 | 内部接口 **fail-closed → 401 / code 20001**（不开放匿名） |
| 是否落盘 | **否**。`ai-service/.env` 只放非敏感可选配置（LLM、超时、RAG 阈值）；`.env` 中已无该键 |
| 健康检查回显 | `/api/v1/health` → `auth.serviceTokenConfigured`、`auth.tokenSource:"process-env:AI_SERVICE_TOKEN"`，**不回显令牌内容** |

**启动方式（令牌按会话注入，不入库、不入文件）：**

```powershell
# pwsh 7
cd mes-upgrade-starter\ai-service
$env:AI_SERVICE_TOKEN = "<临时令牌>"        # 仅本会话生效
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000 --host 127.0.0.1
```

```bash
# bash
cd mes-upgrade-starter/ai-service
AI_SERVICE_TOKEN="<临时令牌>" ./.venv/Scripts/python.exe -m uvicorn main:app --port 8000 --host 127.0.0.1
```

**审查/联调方自验方式**（令牌由启动方提供，不写入仓库）：

```powershell
# 用你启动实例时注入的同一令牌（只输出状态码，不回显令牌）
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://127.0.0.1:8000/api/v1/ai/rag-answers `
  -H "Authorization: Bearer $env:AI_SERVICE_TOKEN" -H "Content-Type: application/json" `
  -d '{"question":"EQP-SMT-006状态","topK":2,"userContext":{"userId":"1","role":"admin"},"requestId":"review"}'
```

**第三轮实测（2026-10-10）**：
- `grep -n AI_SERVICE_TOKEN ai-service/.env` → **0 命中**；全目录 `grep -rn '^AI_SERVICE_TOKEN='`（排除 `.venv`）→ **无任何文件赋值**
- 以会话注入的令牌启动 → 内部接口 **200**
- **不注入**令牌另起实例（8001）→ `/health` 200 且 `serviceTokenConfigured:false`；内部接口带任意 `Bearer` 也一律 **401/20001**

---

## 10. 第三轮修复记录（补测报告 8 项不通过）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。
> 每一项都用补测报告给出的**反例**复现（修复前 → 修复后），并做全量回归。
> 版本号 `0.2.0` → **`0.3.0`**。

### 10.1 逐项修复说明（文件 + 行号 + 改了什么）

| # | 文件:行 | 改了什么 |
|---|---|---|
| **1** 超纲不得标 answered | `main.py:96-110`（`_rag_min_score`/`RAG_MIN_SCORE`）、`main.py:718-721`（`rag_answers`） | 新增**证据阈值**：非编号类问题在检索后，若**无命中或最高分 < `RAG_MIN_SCORE`（默认 0.12）** → `answerStatus:"not_found"`、`citations:[]`。阈值可用 `AI_RAG_MIN_SCORE` 覆盖 |
| **2** 编号完整精确匹配 | `main.py:203`（`_CODE_TOKEN_RE`）、`main.py:206-220`（`_code_tokens`/`_KNOWN_PROD_LINES`）、`main.py:694-698` | 编号正则由 `[A-Z]{2,}-[A-Z0-9\-]+` 改为 **`[A-Za-z]{2,}(?:-[A-Za-z0-9]+)+`**：原正则遇 `JC-IoT-999` 会在小写 `o` 处截断成 `JC-I`，从而误命中 `JC-IoT-4G-A` 的内容。同时把**产线编号**（从知识库推导的 7 条）从"编号精确匹配"中排除，改走正常检索 |
| **3** 不支持的意图不改写 | `main.py:881-882`（`_UNSUPPORTED_GROUP_KW`/`_UNSUPPORTED_OP_KW`）、`main.py:936-944`（`query_intents`） | 新增**不支持项判定**：出现 `车间/工段/班组/部门/工序/工位/班次/客户/供应商/产品线` 等分组词（且无任何受支持分组线索）或 `平均/均值/汇总/合计/总计/占比/比例/环比/同比/排名/排序` 等操作词 → **`supported:false`** 并给出 `reason`，不再默认改写成 `prodLine`+`list` |
| **4** 查询范围不丢限定 | `main.py:803-818`（`_extract_prod_line`）、`main.py:824-878`（`_parse_dates`） | ① 产线识别弃用 `\b`（中文是 `\w`，中文与 ASCII 间无词边界，导致「查看SMT-2产量」丢限定），改为**只匹配知识库中真实存在的产线编号**并用 `(?<![A-Za-z0-9\-])`/`(?!\d)` 界定；② 日期解析改为**先收集全部线索再取并集区间**，显式日期与「今天/昨天/近7天/本周」混用时不再丢弃任一方 |
| **5** 全 null 不得标 answered | `main.py:1026-1029`（`_build_query_answer`） | 新增：`rows` 非空但**指标列全部为 null/缺失** → `answerStatus:"no_data"` + 说明文案（原实现逐行输出"无数据"但仍标 `answered`） |
| **6** 正常证据不生成原因 | `main.py:1143-1166`（`_ev_polarity` 等）、`main.py:1179-1210`（`root_cause_analyses`） | 新增**证据极性判定**：先剥离否定式（`无异常`/`未见故障`）再匹配异常词（避免子串误判），把证据分为 abnormal/normal/neutral；**只有异常侧证据才生成 `possibleCauses`**。全为正常 → `analysisStatus:"no_anomaly"` + `explanation`（"证据显示…正常，未发现异常"）；全为中性 → `insufficient_evidence` + explanation |
| **7** 缺演示标识不得成功 | `main.py:601-602`（`DashboardDTO`）、`main.py:449-455`（`AlertItem`）、`main.py:398-413`（`_check_rfc3339`）、`main.py:500-505` / `:520-525`（`snapshotAt` 校验） | ① `metrics.dataSource`/`metrics.dataLabel` 由可选改为**必填**（契约 §2.3 演示标识）→ 缺失 10001；② `AlertItem.type` 改为**必填**（空预警对象 `{}` → 10001）；③ 新增 `snapshotAt` 的 **RFC 3339 校验**（必须含 `T` 且可解析）→ 非法值 10001（`daily-reports` 与 `root-cause-analyses` 两处） |
| **8** 令牌不落盘 | `main.py:66`（`_PROCESS_ENV`）、`main.py:85`（`AI_SERVICE_TOKEN`）、`.env`、`.env.example`、`§9` | 在 `load_dotenv` **之前**捕获进程环境，令牌改为 `_PROCESS_ENV.get("AI_SERVICE_TOKEN")` —— 即使 `.env` 有同名键也无法注入；从 `.env` 中**彻底删除**该键（`grep` 0 命中）；`.env.example` 与 §9 改写为"按会话注入"的启动说明 |

### 10.2 反例复现（修复前 → 修复后，逐项实测）

| # | 反例 | 修复前 | 修复后（实测） |
|---|---|---|---|
| 1a | `量子纠缠是什么？` | 已 `not_found`（无命中） | `not_found`、`citations:[]` ✅ |
| 1b | `今天天气怎么样？` | **`answered`**（top=0.083，引用了"数据统计耗时长"） | **`not_found`**、`citations:[]` ✅ |
| 1c | `午饭吃什么？` | `not_found` | `not_found` ✅ |
| 2a | `JC-IoT-999有哪些工序？` | **`answered`**，返回 **JC-IoT-4G-A** 的工序（token 被截成 `JC-I`） | **`not_found`** ✅ |
| 2b | `EQP-SMT-999…` / `EQP-SMT-00…` | `not_found`（第二轮已修） | `not_found` ✅（回归保持） |
| 2c | `JC-IoT-4G-A有哪些工序？` | `answered` | `answered`（top=0.371）✅ 无退化 |
| 2d | `JC-IoT-NB-A是什么产品？`（**无数字**编号） | — | `answered`（top=0.705）✅ 大小写/无数字编号均可匹配 |
| 3a | `各车间的产量是多少？` | **`supported:true`**，被改写成 `groupBy=prodLine` | **`supported:false`**：`暂不支持按「车间」分组…` ✅ |
| 3b | `各产线的平均良品率是多少？` | `supported:true`，`operation=list` | **`supported:false`**：`暂不支持「平均」类操作…` ✅ |
| 3c | `按工序统计不良数量` | `supported:true`（被改写） | **`supported:false`**：`暂不支持按「工序」分组…` ✅ |
| 4a | `查看SMT-2产量` | `prodLine:null`（`\b` 在中文前失效，**丢限定**） | `prodLine:"SMT-2"` ✅ |
| 4b | `2026-10-01 到今天各产线的产量` | `2026-10-01 ~ 2026-10-01`（**丢"今天"**） | `startDate:"2026-10-01"`, `endDate:"2026-10-10"` ✅ |
| 4c | `昨天和今天的产量` | `2026-10-09 ~ 2026-10-10` | 同上 ✅（回归保持） |
| 4d | `上个月的产量` | `clarificationRequired:true` | 同上 ✅（回归保持） |
| 5 | `rows=[{SMT-1,goodRate:null},{SMT-2,goodRate:null}]` | **`answered`**（逐行"无数据"） | **`answerStatus:"no_data"`**：`所查询范围内「报工良品率」全部为空值，无可用数据。` ✅ |
| 6a | 证据 `设备状态：运行中，无异常` | **`hypothesis`** + 生成原因（`无异常`里的"异常"被子串命中） | **`analysisStatus:"no_anomaly"`**、`possibleCauses:[]` + explanation ✅ |
| 6b | 证据 `设备运行正常` / `巡检未见异常` | `hypothesis` | **`no_anomaly`** ✅ |
| 6c | 证据 `设备状态：维修中，加热区故障` / `存在不正常的振动` / `当前运行中，但上午出现加热区故障` | `hypothesis` | **`hypothesis`**（各 1 条原因）✅ 无退化 |
| 6d | 证据 `设备在设备清单中存在`（中性） | `hypothesis` | **`insufficient_evidence`** + "证据均为中性事实…" ✅ |
| 7a | 日报 `metrics` 缺 `dataSource` / 缺 `dataLabel` | **200 成功** | **400/10001**：`metrics.dataSource 必填字段缺失` / `metrics.dataLabel 必填字段缺失` ✅ |
| 7b | `alerts:[{}]` / `alert:{}` | 200（空对象被放行） | **400/10001**：`alerts.0.type` / `alert.type 必填字段缺失` ✅ |
| 7c | `snapshotAt:"not-a-date"` / `"2026-10-09"` | 200 | **400/10001**：`时间格式必须为 RFC 3339…` ✅ |
| 8a | `.env` 中是否残留令牌 | 有 `AI_SERVICE_TOKEN=` 一行 | `grep` **0 命中**；全目录无任何文件以 `AI_SERVICE_TOKEN=` 赋值 ✅ |
| 8b | 不注入令牌启动后调用内部接口 | （此前 .env 会兜底，实际可用） | **401/20001** `服务令牌未配置，内部接口不可用`；带任意 `Bearer` 亦然 ✅ |

### 10.3 回归测试（确认无退化）

| 项 | 结果 |
|---|---|
| **RAG 5 个预设问题** | 全部 `answered`，引用与第二轮**完全一致**：① `kb-030`(0.267) ② `kb-028`(0.374) ③ `kb-018`(0.550) ④ `kb-031`(0.489) ⑤ `kb-010`(0.214) ✅ |
| 5 接口 happy-path（`rag-answers`/`query-intents`/`query-answers`/`root-cause-analyses`/`daily-reports`） | 全部 **200** ✅ |
| `/api/v1/health`、`/health`、`/docs` | **200** ✅ |
| 认证：无令牌 / 错误令牌 | **401/20001** ✅ |
| 未知路径 | **404/30001** ✅ |
| 统一包体 `{code,message,data}` | 全部响应一致（含错误）✅ |
| `X-Request-Id` | 每响应均带 ✅ |
| 日报数字**原样透传**（第二轮行为） | 合法日报 200，`overview` 与入参逐字段一致 ✅ |
| 第二轮反例（编号/日期/根因/校验） | 见 §10.2 中标注"回归保持"的各行 ✅ |
| F3 四个示例意图 | 全部 `supported:true` 且字段正确 ✅ |

> **模型路径**：第三轮未改动 LLM 调用逻辑（P2-7/P2-9 已在第二轮验证）；本轮回归在**本地模式**下完成。

### 10.4 本轮变更文件

- **修改**：`ai-service/main.py`（1235 → **1406** 行）、`ai-service/.env`、`ai-service/.env.example`、`docs/handovers/s3-ai-service.md`（新增 §10、重写 §9）
- **未改动**：`ai-service/rag.py`、`ai-service/knowledge.json`、`db/*`、`docs/api-contract.md`、`ai-demo/**`、`backend/**`

### 10.5 遗留 / 需复审确认

- [ ] **`RAG_MIN_SCORE` 取值**：现取 **0.12**。实测应命中问题 top 分 ≥ 0.154、超纲问题 ≤ 0.083，0.12 居中；
      若后续知识库扩充导致合法问题得分下移，可用 `AI_RAG_MIN_SCORE` 覆盖（无需改码）。
- [ ] **不支持项判定为"关键字命中"**：`车间/工序` 等分组词若作为**限定语**出现在有受支持分组线索的句子里
      （如"车间里SMT-2产线的产量"），仍按 `prodLine` 处理 —— 这是为兼容既有正确行为做的取舍，已在此标注。
- [ ] **`AlertItem.type` 必填**：如 NestJS 侧存在无 `type` 的预警，会被 10001 拒绝；如需放宽请回退该字段为可选。
- [x] ~~**`AI_API_KEY` 仍在 `.env` 支持范围内**：本轮按报告只处理了 `AI_SERVICE_TOKEN`（密钥不落盘）。
      若要求 LLM 密钥同样不落盘，需一并改为纯进程环境注入（属新决策，未自行扩大范围）。~~
      → **第四轮已修正，且更正表述**：这**不是新决策**——项目铁律「密码、密钥、Token 全部走环境变量，
      禁止硬编码，禁止写进 git」本就覆盖**全部**密钥。现已移除 `python-dotenv` 与 `.env` 读取，
      **所有配置（含 LLM Key）只认进程环境变量**，详见 §11.1。
- [ ] 其余第二轮遗留项（chunkId 临时编号、限流占位、`ai_query_log` 持久化）状态不变，见 §8.8。

---

## 11. 第四轮修复记录（复审 8 项 + 凭据规则）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。
> 每一项都用复审给出的**反例**复现（修复前 → 修复后），并做全量回归。
> 版本号 `0.3.0` → **`0.4.0`**。

### 11.1 P1-1｜凭据规则全部落实（含跨阶段）

**(a) ai-service：全部配置只认进程环境变量**

| 项 | 改动 |
|---|---|
| 代码 | `main.py:66-77` 用 `_ENV = dict(os.environ)` + `_env()` 读取**全部**配置；**移除 `from dotenv import load_dotenv` 与 `load_dotenv(...)`** |
| 依赖 | `requirements.txt` 删除 `python-dotenv` |
| 文件 | **删除 `ai-service/.env`**；`.env.example` → 改名 **`env.example`**（纯变量清单 + 注入示例，明确"本服务不读取 .env"） |
| 校验 | `grep -rn "dotenv" main.py rag.py requirements.txt` → 仅剩注释；`grep -c AI_SERVICE_TOKEN .env` 不再适用（文件已删） |

> **更正表述**：第三轮把"LLM Key 是否落盘"写成"属新决策"是**错误**的。项目铁律
> 「密码、密钥、Token 全部走环境变量，禁止硬编码，禁止写进 git」本就覆盖全部密钥，
> 本轮按原铁律执行，无需新决策。

**(b) 跨阶段存量明文凭据**（经用户确认后执行）

| 位置 | 处置 |
|---|---|
| `backend/.env` | `DB_PASSWORD` **清空**（原非空口令已删除）；加注"按会话注入"；`backend/.env.example` 同步 |
| `db/seed_from_excel.py:91` | 注释中的明文初始口令 → 改为"不落盘任何初始口令明文" |
| `data/05_人员账号.xlsx` | 「初始密码」列 23 行 → `<首登强制修改>`（用户选择：只脱敏工作副本，保留企业原件） |
| `ai-service/knowledge.json` + `ai-demo/knowledge.json` | 各 **23 处** `初始密码：<已脱敏>` → `初始密码：<首登强制修改>`（知识库由 xlsx 构建，同样带口令） |
| `docs/handovers/s2-backend-skeleton.md` | 新增「凭据口径变更」小节（原「口令只写 `.env`」口径废止） |

**仍存留（用户决定保留）**：根目录 `企业数据文件/05_人员账号.xlsx`（企业原始素材）。
如需一并脱敏，可直接复用本次脚本逻辑对该文件执行同样的列替换。

**终检**：全工作区二进制+文本扫描「原明文初始口令字面量」→ **0 命中**；各 `.env` 非空凭据只剩 `DB_USERNAME=root`（用户名，非密钥）。

### 11.2 其余 7 项修复说明（文件 + 行号 + 改了什么）

| # | 文件:行 | 改了什么 |
|---|---|---|
| **P1-2** RAG 无依据拒答 | `main.py:236-330`（`_KB_TEXT`/`_OUT_OF_SCOPE_KW`/`_STOP_PHRASES`/`_uncovered_content_runs`/`_rag_evidence_problem`/`_code_answer_covers`）、`main.py:792-800`（入口校验） | 新增**三层依据校验**：① 超纲主题/字段词表；② **未覆盖内容片段**——以知识库自身为词典做最大匹配，问题中连续 ≥2 字"库内完全没有"的内容词即判无依据；③ 原有检索分阈值。校验在**编号命中之前**执行，编号路径另加 `_code_answer_covers` 复查；拒答带 `reason` |
| **P1-3** 不支持意图不改写 | `main.py:1030-1052`（词表 + `_GROUPING_PATTERNS` + `_explicit_grouping_dimension`）、`main.py:1090-1106` | 补 `操作员/操作者/人员/员工/工人/机台/机型/订单/工单/物料/产品` 等分组词与 `中位/众数/标准差/方差/占比/环比/同比/排名/排序/增幅/降幅` 等操作词；新增**分组构式识别**（按X/各X/分X/每X/X分组）以区分「明确分组要求」与「限定语」；命中即 `supported:false` |
| **P1-4** 查询范围不丢 | `main.py:913-947`（`_extract_prod_lines`/`_unknown_prod_lines`）、`main.py:948-1000`（`_parse_dates`）、`main.py:1108-1116` | 产线改为**返回全部命中**：未知产线（如 `SMT-999`）→ 拒绝并列出可用产线；多产线（`SMT-2和SMT-3`）→ 拒绝；新增 `_FUTURE_PERIODS`（明天/后天/下周…）→ **澄清**（不再改写成今天）；`_parse_dates` 改为返回 `(start,end,status,reason)`，理由随澄清返回 |
| **P1-5** 指标类型有效值 | `main.py:1170-1183`（`_has_value`）、`main.py:1223-1226` | 新增 `_has_value(metric, v)`：**按指标类型**判断（字符串指标非空即有效）；`no_data` 判定与逐行文案均改用它，`deviceStatus:"运行中"` 可正常转述 |
| **P1-6** 证据极性 | `main.py:1300-1330`（`_NEG_ABNORMAL_RE`/`_NEG_NORMAL_RE`/`_ZERO_ABNORMAL_RE`/`_ev_polarity`） | 否定式允许 0-3 个中间字（`未发生故障`）；新增**零异常事实**识别（`不良数量为0`/`异常0次`）；`不合格/未达标/不符合` 判异常。极性判定改为：先剥离否定式与零异常表述，再匹配异常词 |
| **P2-7** 必填与 RFC3339 | `main.py:398-414`（`_check_rfc3339`）、`main.py:516-530`（`RootCauseRequest`）、`main.py:546-565`（`DailyReportRequest`） | `evidence`/`alerts`/`snapshotAt` 全部改为**必填**（契约 §4.1）；RFC 3339 校验新增**时区要求**（必须 `Z` 或 `±HH:MM`） |
| **P2-8** 演示标识内容 | `main.py:600-630`（`DashboardDTO`） | 新增 `_not_blank` 校验（拒绝空白串）与 `_demo_label_must_match` 模型校验：`dataSource:"demo"` ⇔ `dataLabel:"演示数据"` |

### 11.3 反例复现（修复前 → 修复后，逐项实测）

| # | 反例 | 修复前 | 修复后（实测） |
|---|---|---|---|
| 1a | LLM 配置来源 | 接受 dotenv 注入 | **只认进程环境**；`main.py` 无 dotenv 引用；`.env` 已删除 |
| 1b | 跨阶段明文凭据 | `backend/.env` 非空口令、两份 xlsx/知识库 23 条明文 | `DB_PASSWORD` 空；两份 xlsx 与两份 `knowledge.json` 已脱敏；全工作区扫描原口令字面量 **0 命中** |
| 2a | `JC-PLC-2001的售价是多少` | **answered**（返回 BOM） | **not_found**：`所问内容「售价」不在企业资料范围内` |
| 2b | `公司的质量追溯问题会影响明天天气吗` | **answered**（top 0.407） | **not_found**：`所问内容「天气」不在企业资料范围内` |
| 2c | `报销流程是什么` / `产品重量是多少` | answered | **not_found**（超纲词表） |
| 3a | `各产线良品率的中位数是多少？` | supported:true | **supported:false**：`暂不支持「中位」类操作…` |
| 3b | `按操作员统计不良数量` | supported:true（改写） | **supported:false**：`暂不支持按「操作员」分组…` |
| 3c | `按工序查看SMT-2产线的产量` | supported:true（因含"产线"跳过检查） | **supported:false**：`暂不支持按「工序」分组…` |
| 3d | `各车间的产量是多少？` | supported:true（改写） | **supported:false**：`暂不支持按「车间」分组…` |
| 4a | `SMT-999的产量` | `prodLine:null`（**静默丢弃**） | **supported:false**：`产线「SMT-999」不存在（可用产线：ASSY-1…）` |
| 4b | `SMT-2和SMT-3的产量` | 只保留 `SMT-2` | **supported:false**：`暂不支持一次查询多条产线…` |
| 4c | `明天的产量` | 改写成今天 | **supported:false + clarificationRequired**：`查询范围只覆盖历史与当日数据…` |
| 5 | `deviceStatus:"运行中"` 查询 | **no_data**（"全部为空值"） | **answered**：`设备 EQP-SMT-006 设备状态 维修中；设备 EQP-SMT-001 设备状态 运行中。` |
| 6a | `设备未发生故障，运行正常` | **hypothesis** + 生成原因 | **no_anomaly**、`possibleCauses:[]` + explanation |
| 6b | `检验不良数量为0，全部合格` | **hypothesis** | **no_anomaly** |
| 6c | `检验结果不合格` / `维修中，加热区故障` | hypothesis | **hypothesis**（无退化） |
| 7a | root-cause 缺 `evidence`/`snapshotAt` | **200** | **400/10001**：`evidence 必填字段缺失`、`snapshotAt 必填字段缺失` |
| 7b | daily-reports 缺 `alerts`/`snapshotAt` | **200** | **400/10001** |
| 7c | `snapshotAt:"2026-10-09T09:00:00"`（无时区） | **200** | **400/10001**：`RFC 3339 时间必须带时区偏移或 Z` |
| 8a | `dataSource:"demo"` + `dataLabel:"真实数据"` | **200** | **400/10001**：`dataSource 为 "demo" 时，dataLabel 必须为 "演示数据"` |
| 8b | `dataLabel:"   "`（空白） | 200 | **400/10001**：`不能为空白字符串` |

### 11.4 回归测试（确认无退化）

| 项 | 结果 |
|---|---|
| 5 接口 happy-path | 全部 **200** ✅ |
| `/api/v1/health`、`/health`、`/docs` | **200** ✅ |
| 无令牌 / 未知路径 | **401/20001**、**404/30001** ✅ |
| 统一包体与 `X-Request-Id` | 一致、每响应均带 ✅ |
| **RAG 5 个预设问题**（脱敏后复跑） | 全部 `answered`；引用 ① `kb-030` ② `kb-028`/`kb-029` ③ `kb-018` ④ `kb-031` ⑤ `kb-010` ✅ |
| 合法 RAG 变体（`设备状态怎么查`/`不良品怎么处理`/`物料安全库存是多少` 等） | 仍 `answered`（依据校验未误伤）✅ |
| F3 四个示例意图 | 全部 `supported:true` 且字段正确（**含 `累计完成率7天趋势`**）✅ |
| 限定语兼容 | `车间里SMT-2产线的产量` → `prodLine:"SMT-2"`；`查看SMT-2产量` → `prodLine:"SMT-2"` ✅ |
| 显式日期+相对日混用 | `2026-10-01 到今天` → `10-01 ~ 10-10` ✅ |
| 日报数字原样透传（第二轮行为） | 合法日报 200，`overview` 与入参一致 ✅ |

> **RAG 依据判据的标定数据**：以 45 条合法问题 + 20 条超纲问题标定；
> 合法问题中仅 1 条（`企业概况是什么`）因检索分低于 0.12 被拒（属阈值固有取舍，非依据校验误伤），
> 超纲问题**全部**被拒（0 漏拒）。

### 11.5 本轮变更文件

- **修改**：`ai-service/main.py`（1406 → **1633** 行）、`ai-service/requirements.txt`、`ai-service/knowledge.json`（脱敏）、
  `ai-demo/knowledge.json`（脱敏）、`backend/.env`、`backend/.env.example`、`db/seed_from_excel.py`（注释）、
  `data/05_人员账号.xlsx`（脱敏）、`docs/handovers/s2-backend-skeleton.md`、`docs/handovers/s3-ai-service.md`
- **新增**：`ai-service/env.example`（替代 `.env.example`）
- **删除**：`ai-service/.env`、`ai-service/.env.example`
- **未改动**：`db/schema.sql`、`db/seed.sql`、`docs/api-contract.md`、`ai-service/rag.py`

### 11.6 遗留 / 需复审确认

- [x] ~~**根目录 `企业数据文件/05_人员账号.xlsx` 仍含 23 条明文初始口令** —— 用户明确选择保留企业原件；
      如需脱敏，可复用同一脚本逻辑（替换第 7 列）。~~
      → **第五轮已按复审要求脱敏**（两份人员账号表均替换为 `<首登强制修改>`），见 §12.1。
- [ ] **`RAG_MIN_RESIDUE`（默认 2）**：依据校验的灵敏度旋钮。调大更宽松（可能漏拒），调小更严格（可能误拒）；
      可用 `AI_RAG_MIN_RESIDUE` 覆盖而无需改码。
- [ ] **依据校验为词表 + 知识库词典启发式**，不是语义蕴含判定：若问题用到知识库完全没有的**同义表述**
      （如把"良品率"说成"合格比率"），可能被判无依据。彻底解决需中文分词或 LLM 语义校验（本版未引入新依赖）。
- [ ] `data/*.xlsx` 脱敏后与根目录原件 **MD5 不再一致**（S1 曾校验一致）；`db/seed.sql` 不受影响
      （导数脚本本就不写初始口令列，仅写占位哈希），故**无需重生成**。
- [ ] 其余遗留（chunkId 临时编号、限流占位、`ai_query_log` 持久化、真实 LLM 供应商未验证）状态不变。

---

## 12. 第五轮修复记录（复审 3 项）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。版本 `0.4.0` → **`0.5.0`**。

### 12.1 P1｜明文口令残留（文档 / 记忆 / 企业原件）

| 位置 | 处置 |
|---|---|
| `docs/handovers/s3-ai-service.md`（第 500/506/525 行附近） | 3 处实际口令字面量 → 改为 `<已脱敏>` / 「原明文初始口令字面量」等描述性表述 |
| `.workbuddy-ai/memory/2026-10-10.md`（第 421/438 行附近） | 2 处实际口令字面量 → 同上 |
| `企业数据文件/05_人员账号.xlsx`（**企业原件**） | 「初始密码」列 23 行 → `<首登强制修改>`（此前按用户选择保留原件，本轮按复审要求一并脱敏） |

**终检（全工作区二进制+文本扫描）**：
- 原口令字面量 → **0 命中**
- `mes-upgrade-starter/data/05_人员账号.xlsx` / `企业数据文件/05_人员账号.xlsx` → 各 23 行、明文 **0**、值均为 `<首登强制修改>`
- `ai-service/knowledge.json` / `ai-demo/knowledge.json` → 原口令 **0 次**、脱敏标记各 **23** 处
- 各 `.env` 非空密钥 → **0 条**（仅剩 `DB_USERNAME=root` 用户名）
- `*.md` 文档 → **0 命中**

### 12.2 P1｜不等价指标不得替换成其他指标

| 文件:行 | 改动 |
|---|---|
| `main.py:986-1004`（`_METRIC_KW` / `_NON_EQUIVALENT_METRIC_KW`） | ① 从 `completionRate` 移除 **`交付率`、`进度`**；从 `outputQty` 移除 **`产能`**。② 新增 `_NON_EQUIVALENT_METRIC_KW`（交付率/准时交付率/产能/效率/稼动率/成本/进度 → 各带**说明文案**）。 |
| `main.py:1141-1146`（`query_intents`） | 不等价判定**优先于指标识别**执行 —— 否则「查询设备效率」会被"设备"命中成 `deviceStatus`。命中即 `supported:false` 并说明原因 + 列出本版支持的指标。 |

### 12.3 P1｜复合分组不得静默丢弃

| 文件:行 | 改动 |
|---|---|
| `main.py:1052-1096`（`_GROUPING_PATTERNS` / `_GROUP_TERMINATORS` / `_group_keys_in` / `_explicit_grouping_dimensions`） | 分组维度改为返回**全部**命中（原先只取首个）：按/各/X分组 三种构式全部扫描，捕获后按终止词（查询/统计/查看…）截断，再按连词（和/与/及/、）**拆成多个维度**。新增 `_group_keys_in()` 统计片段内的受支持维度数。 |
| `main.py:1148-1172`（`query_intents`） | 逐个维度检查：含不支持词 → 拒绝；无法识别 → 拒绝；**单个片段含多个维度 → 复合分组，拒绝**；各维度归并后**多于一个维度 → 复合分组，拒绝**。 |

### 12.4 反例复现（修复前 → 修复后）

| # | 反例 | 修复前 | 修复后（实测） |
|---|---|---|---|
| 1a | 交接文档 / 记忆文件 | 含实际口令字面量（5 处） | **0 命中**（改为描述性表述） |
| 1b | `企业数据文件/05_人员账号.xlsx` | 23 行明文 | **23 行均为 `<首登强制修改>`** |
| 2a | `查询产线交付率` | **supported:true, metric:"completionRate"** | **supported:false**：`暂不支持「交付率」指标：…不是同一口径` |
| 2b | `查询产能` | **supported:true, metric:"outputQty"** | **supported:false**：`暂不支持「产能」指标：…与「产量」不是同一指标` |
| 2c | `查询设备效率` | supported:true, metric:"deviceStatus"（被"设备"命中） | **supported:false**：`暂不支持「效率」指标…` |
| 2d | `查询SMT-2的进度` | supported:true, metric:"completionRate" | **supported:false**：`「进度」含义不唯一…` |
| 3a | `按产线和操作员查询产量` | **supported:true, groupBy:"prodLine"**（操作员丢失） | **supported:false**：`暂不支持按「操作员」分组…` |
| 3b | `按产线再按操作员查询产量` | supported:true（操作员丢失） | **supported:false**：同上 |
| 3c | `按产线和日期查询产量` | supported:true（日期丢失） | **supported:false**：`暂不支持复合分组（同时按 date、prodLine）…` |
| 3d | `各产线每天的良品率` | supported:true（"每天"丢失） | **supported:false**：`暂不支持复合分组「产线每天的良品率」（同时涉及 date、prodLine）…` |

### 12.5 回归测试（确认无退化）

| 项 | 结果 |
|---|---|
| 5 接口 happy-path | 全部 **200** ✅ |
| `/api/v1/health`、`/health`、`/docs` | **200/200/200** ✅ |
| 无令牌 / 未知路径 | **401** / **404** ✅ |
| **RAG 5 个预设问题** | 全部 `answered`，引用不变（`kb-030` / `kb-028`+`kb-029` / `kb-018` / `kb-031` / `kb-010`）✅ |
| RAG 超纲（`JC-PLC-2001的售价是多少`） | **not_found** ✅ |
| **F3 四个示例意图** | 全部 `supported:true` 且字段正确 ✅ |
| 合法分组（`按产线查询产量` / `各产线良品率` / `各设备状态` / `每天的产量`） | 全部 `supported:true` ✅ |
| 限定语兼容（`车间里SMT-2产线的产量` / `查看SMT-2产量`） | `prodLine:"SMT-2"` ✅ |

### 12.6 本轮变更文件

- **修改**：`ai-service/main.py`（1633 → **1696** 行）、`docs/handovers/s3-ai-service.md`、`.workbuddy-ai/memory/2026-10-10.md`、
  `企业数据文件/05_人员账号.xlsx`（脱敏）
- **未改动**：`db/schema.sql`、`db/seed.sql`、`docs/api-contract.md`、`ai-service/rag.py`、`ai-service/knowledge.json`（四轮已脱敏）

### 12.7 遗留 / 需复审确认

- [ ] **`_NON_EQUIVALENT_METRIC_KW` 是词表**：若出现词表外的不等价说法（如"良品比率""一次通过率"），
      仍可能落到"无法识别指标"（同样是 `supported:false`，只是文案不同）。彻底解决需口径白名单 + 语义判定。
- [ ] **`交付率` 从 `completionRate` 移除后**，如后续确认"交付率"就是累计完成率，请显式批准后再加回。
- [ ] 其余遗留（chunkId 临时编号、限流占位、`ai_query_log` 持久化、真实 LLM 供应商未验证）状态不变。

---

## 13. 第六轮修复记录（复审 2 项）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。版本 `0.5.0` → **`0.6.0`**。

### 13.1 P1｜分组要求仍被静默丢弃

| 文件:行 | 改动 |
|---|---|
| `main.py:1071-1085`（`_GROUPING_PATTERNS` / `_GROUP_SPLIT_RE`） | ① 捕获字符类**不再排除顿号**（原先 `[^，。；？?、\s]` 会在顿号处截断，「按产线、操作员」只剩"产线"）；② 新增 **「每个/每条/每台/每种/每位/每名/每批」** 构式，并用 `(?!天\|日\|月\|年\|周\|季)` 排除"每天/每日"等**日期口径**；③ 维度拆分改用 `_GROUP_SPLIT_RE`（含 `、`）。 |
| `main.py:1096-1111`（`_unsupported_group_hit`） | 新增带**方位后缀豁免**的不支持维度扫描：`车间里/车间内/车间中` 视为**范围限定语**（不是分组要求），其余位置出现不支持维度一律命中。 |
| `main.py:1210-1231`（`query_intents`） | **取消**「已识别到分组就跳过整句扫描」的捷径（原 `if not dims and group_by is None`）：现在无论是否已解析出分组，都会对整句做一次不支持维度扫描 —— 「按产线查看操作员的产量」中的操作员也能被拦下。 |

### 13.2 P1｜日报内部接口 `suggestions` 类型与契约不一致

| 文件:行 | 改动 |
|---|---|
| `main.py:1598-1612`（`_assemble_daily_report`） | `suggestions` 由 `List[Dict]`（`{alertId,text}`）改为 **`List[str]`**，只放建议文本；`alertId ↔ 建议` 的关联由**公开日报 DTO 层（NestJS）**组装。逐条预警的 `suggestion` 仍保留在 `alerts[]` 内，NestJS 可据此还原 `{alertId,text}`。 |

契约 §4.1 目标形状（已对齐）：

```json
{"overviewText":"演示数据：…","suggestions":["请质检员复核该时段不良类型与检验记录。"],"mode":"local","degraded":false,"usage":{"tokensIn":0,"tokensOut":0},"latencyMs":0}
```

### 13.3 反例复现（修复前 → 修复后）

| # | 反例 | 修复前 | 修复后（实测） |
|---|---|---|---|
| 1a | `按产线、操作员查询产量` | **supported:true, groupBy:"prodLine"**（操作员丢失） | **supported:false**：`暂不支持按「操作员」分组…` |
| 1b | `按产线、日期查询产量` | **supported:true, groupBy:"prodLine"**（日期丢失） | **supported:false**：`暂不支持复合分组（同时按 date、prodLine）…` |
| 1c | `每个操作员按产线查询产量` | **supported:true, groupBy:"prodLine"**（操作员丢失） | **supported:false**：`暂不支持按「操作员」分组…` |
| 1d | `按产线查看操作员的产量`（同类扩展） | supported:true（跳过整句扫描） | **supported:false**：`暂不支持按「操作员」分组…` |
| 1e | `按产线、日期、设备查询产量` | supported:true（只剩产线） | **supported:false**：`暂不支持复合分组（同时按 date、device、prodLine）…` |
| 1f | `每条产线按工序统计产量` | supported:true | **supported:false**：`暂不支持按「工序」分组…` |
| 1g | `一车间的产量` | supported:true（改写为产线） | **supported:false**：`暂不支持按「车间」分组…` |
| 2a | 日报 `suggestions` | `[{"alertId":"801","text":"…"}]`（对象数组，与契约不符） | **`["请质检员复核该时段不良类型与检验记录。"]`**（字符串数组）✅ |
| 2b | 预警无 `suggestion` 时 | `[]` | **`[]`** ✅ |

### 13.4 回归测试（确认无退化）

| 项 | 结果 |
|---|---|
| 5 接口 happy-path | 全部 **200** ✅ |
| `/api/v1/health`、`/health`、`/docs` | **200/200/200** ✅ |
| 无令牌 / 未知路径 | **401** / **404** ✅ |
| **RAG 5 个预设问题** | 全部 `answered`，引用不变（`kb-030` / `kb-028`+`kb-029` / `kb-018` / `kb-031` / `kb-010`）✅ |
| RAG 超纲（`JC-PLC-2001的售价是多少`） | **not_found** ✅ |
| **F3 四个示例意图** | 全部 `supported:true` 且字段正确 ✅ |
| 合法分组构式 | `按产线查询产量` / `每条产线的产量` / `每种设备的产量` / `每天的产量` / `各产线良品率` 全部 `supported:true` ✅ |
| **限定语豁免** | `车间里SMT-2产线的产量` → `prodLine:"SMT-2"`（`车间里` 不被判为分组要求）✅ |
| 限定语（产线过滤） | `查看SMT-2产量` → `prodLine:"SMT-2"` ✅ |

### 13.5 本轮变更文件

- **修改**：`ai-service/main.py`（1696 → **1730** 行）、`docs/handovers/s3-ai-service.md`
- **未改动**：`db/*`、`docs/api-contract.md`、`ai-service/rag.py`、`ai-service/knowledge.json`、`backend/**`

### 13.6 遗留 / 需复审确认

- [ ] **「每个/每条」构式**只覆盖已列举的量词（个/条/台/种/位/名/批）；若出现其它量词（如「每类」「每道」），
      会落到"无法确定分组维度"（同为 `supported:false`，文案不同）。
- [ ] **`车间里/内/中` 豁免**是刻意保留的兼容行为：这类是范围限定语，但契约 groupBy 无"车间"维度，
      故不参与分组判定。若要求此类限定也一律拒绝，请显式批准后移除该豁免。
- [ ] 其余遗留（chunkId 临时编号、限流占位、`ai_query_log` 持久化、真实 LLM 供应商未验证）状态不变。

---

## 14. 第七轮修复记录（复审 1 项）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。版本 `0.6.0` → **`0.7.0`**。

### 14.1 P1｜产线过滤抢占显式分组要求

**问题**：`query_intents` 先按**整句关键词**猜 `groupBy`（`_pick_by_longest(question, _GROUP_KW)`），
而显式分组构式解析出的 `resolved_groups` **只用于拒绝复合分组、并未覆盖最终 `groupBy`**。
于是「SMT-2产线按日期统计产量」里，作为**过滤条件**的"产线"抢占了明确要求的分组轴，返回 `groupBy:"prodLine"`。

| 文件:行 | 改动 |
|---|---|
| `main.py:1224-1233` | 新增**显式分组优先**规则：`len(resolved_groups) == 1` 时，用该维度**覆盖**整句关键词猜测的 `group_by`；其余维度（如产线）只作**过滤条件**（`prodLine` 字段）。 |
| `main.py:1227-1230` | ~~新增**冲突判定**：「按产线」分组 + 同时指定单条产线（如 `按产线统计SMT-2的产量`）→ `supported:false` + `clarificationRequired:true`。~~ **⚠️ 该规则已于第八轮移除（属误拒，见 §15.2）** |
| `main.py:1235-1237` | 新增 **trend 归一**：`operation == "trend"` 且显式分组未指定 prodLine 时，`group_by` 固定为 `date`（产线只作过滤）——此前「SMT-2产线良品率的趋势」会因 `prodLine+trend` 组合非法被拒。**⚠️ 触发条件已于第八轮收窄为「无任何明确分组要求」，见 §15.1** |

### 14.2 反例复现（修复前 → 修复后）

| # | 反例 | 修复前 | 修复后（实测） |
|---|---|---|---|
| 1a | `SMT-2产线按日期统计产量` | **groupBy:"prodLine"**（产线抢占，"按日期"丢失） | `{"metric":"outputQty","groupBy":"date","prodLine":"SMT-2","operation":"list"}` ✅ |
| 1b | `按日期统计SMT-2产线的产量` | groupBy:"prodLine" | `groupBy:"date"`, `prodLine:"SMT-2"` ✅ |
| 1c | `SMT-2产线按设备统计产量` | groupBy:"prodLine" | `groupBy:"device"`, `prodLine:"SMT-2"` ✅ |
| 1d | `按产线统计SMT-2的产量`（冲突） | groupBy:"prodLine" | **supported:false + clarificationRequired**：`「按产线」分组与产线限定「SMT-2」冲突…` ✅ |
| 1e | `SMT-2产线良品率的趋势` | `prodLine+trend` 组合非法 → 拒绝 | `{"metric":"goodRate","groupBy":"date","prodLine":"SMT-2","operation":"trend"}` ✅ |

### 14.3 回归测试（确认无退化）

| 项 | 结果 |
|---|---|
| 5 接口 happy-path | 全部 **200** ✅ |
| `/api/v1/health`、`/health`、`/docs` | **200/200/200** ✅ |
| 无令牌 / 未知路径 | **401** / **404** ✅ |
| 日报 `suggestions` | 仍为字符串数组 `["请质检员复核。"]` ✅ |
| **RAG 5 个预设问题** | 全部 `answered`，引用不变 ✅ |
| RAG 超纲（`JC-PLC-2001的售价是多少`） | **not_found** ✅ |
| **F3 四个示例意图** | 全部 `supported:true` 且字段正确 ✅ |
| 无显式构式的分组猜测 | `按产线查询产量`→prodLine；`各产线良品率`→prodLine；`每天的产量`→date；`各设备状态`→device ✅ |
| 产线过滤（无限定分组） | `查看SMT-2产量`、`车间里SMT-2产线的产量` → `groupBy:"prodLine"`, `prodLine:"SMT-2"` ✅ |
| 复合/不支持分组（六轮行为） | `按产线和操作员查询产量`、`每个操作员按产线查询产量` 仍 `supported:false` ✅ |

### 14.4 本轮变更文件

- **修改**：`ai-service/main.py`（1727 → **1739** 行）、`docs/handovers/s3-ai-service.md`
- **未改动**：`db/*`、`docs/api-contract.md`、`ai-service/rag.py`、`ai-service/knowledge.json`、`backend/**`

### 14.5 遗留 / 需复审确认

- [ ] **无显式构式时仍沿用关键词猜测**（如 `查看SMT-2产量` → `groupBy:"prodLine"` + `prodLine:"SMT-2"`）。
      这是刻意保留的兼容行为（该问法在历轮复审中均被接受）；若要求此类"单产线过滤"也改为
      "分组轴应为 date/无分组"，请显式批准后再改。
- [ ] **冲突判定只覆盖「按产线 + 单条产线」**；其它潜在冲突（如"按设备 + 指定设备"）目前不拦。
      如需扩展，可在同一位置追加。~~（**第八轮已移除该判定**，见 §15.2）~~
- [ ] 其余遗留（chunkId 临时编号、限流占位、`ai_query_log` 持久化、真实 LLM 供应商未验证）状态不变。

---

## 15. 第八轮修复记录（复审 2 项 · 均为第七轮引入的回归）— 2026-10-10

> 原则：**只收紧/修正，不新增接口、不改表结构、不改变合法请求的原有正确行为**。版本 `0.7.0` → **`0.8.0`**。

### 15.1 P1｜趋势归一再次覆盖明确分组（第七轮回归）

**问题**：第七轮加的 `if operation == "trend" and "prodLine" not in resolved_groups: group_by = "date"`
触发条件过宽 —— 只要有明确分组**不是 prodLine**（如 `device`/`defectType`），也会被强制改成 `date`，
把用户要求的维度丢掉，于是本该 `supported:false` 的组合变成了成功返回。

| 文件:行 | 改动 |
|---|---|
| `main.py:1235-1240` | 触发条件由 `"prodLine" not in resolved_groups` 收窄为 **`not resolved_groups`** —— **仅当完全没有明确分组要求时**才把趋势默认到 `date`；有明确分组时保留该要求，交给 `_is_allowed_combo()` 判断是否支持。 |

### 15.2 P2｜新增冲突规则误拒合法查询（第七轮回归）

**问题**：第七轮加的「按产线分组 + 单条产线限定 → 冲突」判定属**过度收紧**：
契约并未禁止 `groupBy:"prodLine"` 与 `prodLine` 过滤并存（`prodLine` 是独立的过滤字段）。

| 文件:行 | 改动 |
|---|---|
| `main.py:1227-1230` | **整段移除**冲突判定；`按产线统计SMT-2的产量` 恢复为合法的 `groupBy:"prodLine"` + `prodLine:"SMT-2"`。 |

### 15.3 反例复现（修复前 → 修复后）

| # | 反例 | 应有结果 | 第七轮（错误） | 第八轮（实测） |
|---|---|---|---|---|
| 1a | `按不良类型查询良品率趋势` | supported:false | **supported:true**，返回 `defectQty/date/trend` | **supported:false**：`不支持的组合：metric=defectQty / groupBy=defectType / operation=trend` ✅ |
| 1b | `按设备查询产量趋势` | supported:false | **supported:true**，返回 `outputQty/date/trend` | **supported:false**：`不支持的组合：metric=outputQty / groupBy=device / operation=trend` ✅ |
| 2 | `按产线统计SMT-2的产量` | supported:true | **supported:false + clarificationRequired**（误拒） | **supported:true**：`{"metric":"outputQty","groupBy":"prodLine","prodLine":"SMT-2","operation":"list"}` ✅ |

### 15.4 回归测试（第七轮修复与历史用例均保持）

| 项 | 结果 |
|---|---|
| **第七轮修复保持**：`SMT-2产线按日期统计产量` | `groupBy:"date"` + `prodLine:"SMT-2"` ✅ |
| **第七轮修复保持**：`SMT-2产线按设备统计产量` | `groupBy:"device"` + `prodLine:"SMT-2"` ✅ |
| **第七轮修复保持**：`SMT-2产线良品率的趋势` | `groupBy:"date"` + `prodLine:"SMT-2"` + `trend` ✅ |
| **F3 四个示例意图** | 全部 `supported:true` 且字段正确 ✅ |
| 无构式分组猜测 | `按产线查询产量`→prodLine；`各产线良品率`→prodLine；`各设备状态`→device；`每天的产量`→date ✅ |
| 产线过滤问法 | `查看SMT-2产量` / `车间里SMT-2产线的产量` → `groupBy:"prodLine"` + `prodLine:"SMT-2"` ✅ |
| 六轮行为 | `按产线和操作员查询产量` 仍 `supported:false` ✅ |
| 五轮行为 | `各产线良品率的中位数` 仍 `supported:false`；`查询产线交付率` 仍 `supported:false` ✅ |
| 5 接口 happy-path / `/health` / `/docs` | 全部 **200** ✅ |
| 无令牌 / 未知路径 | **401** / **404** ✅ |
| 日报 `suggestions` | 仍为字符串数组 ✅ |
| **RAG 5 个预设问题** | 全部 `answered`，引用不变 ✅ |
| RAG 超纲 | `not_found` ✅ |

### 15.5 本轮变更文件

- **修改**：`ai-service/main.py`（1746 → **1750** 行）、`docs/handovers/s3-ai-service.md`（含回填 §14 的两处失效描述）
- **未改动**：`db/*`、`docs/api-contract.md`、`ai-service/rag.py`、`ai-service/knowledge.json`、`backend/**`

### 15.6 遗留 / 需复审确认

- [ ] **无显式构式时仍沿用关键词猜测**（`查看SMT-2产量` → `groupBy:"prodLine"` + `prodLine:"SMT-2"`），
      与第八轮放行的 `按产线统计SMT-2的产量` 行为一致；如需改为"分组轴应为 date/无分组"，请显式批准。
- [ ] **趋势 + 明确分组的组合**：本版按组合矩阵一律 `supported:false`（trend 仅支持 groupBy=date）。
      若后续希望支持"按产线看趋势"，需契约侧先放开组合矩阵。
- [ ] 其余遗留（chunkId 临时编号、限流占位、`ai_query_log` 持久化、真实 LLM 供应商未验证）状态不变。





