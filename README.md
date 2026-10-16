# 精创电子 MES + AI

精创电子科技有限公司制造执行系统（MES）升级项目。项目以生产订单为入口，贯通工单、工序报工、质量检验、物料、设备、追溯、经营看板、预警和 AI 辅助能力，配套 Vue 3 Web/PWA、NestJS 业务后端、FastAPI AI 服务和 MySQL 8 数据契约。

本仓库当前定位为**可本地启动、可完整展示、已完成代码审查和自动化回归的演示交付版本**。它不是生产环境上线声明：真实 MySQL 隔离验收、真实三角色登录、浏览器/移动设备实机闭环、生产数据验收和组织上线签批属于后续受控阶段。

## 当前状态

| 范围 | 状态 | 说明 |
|---|---|---|
| S0-S12 代码与文档 | 已完成 | 各阶段交接文档保存在 `docs/handovers/` |
| 自动化回归 | 已完成 | 后端、前端、AI 服务、静态边界和构建均有独立证据 |
| 本地展示 | 就绪 | 使用演示数据和本地模式即可展示主要业务闭环 |
| 真实 MySQL/JWT 集成 | 待授权执行 | 需要隔离库，不连接生产库 |
| Chrome/Edge/PWA 实机验收 | 待执行 | 桌面模拟和静态检查不能替代真实设备验收 |
| 生产数据验收与上线批准 | 未完成 | 由业务、技术和运维责任人签署，不由代码审查代签 |

## 能力范围

### 基础 MES

- 生产订单、工单及工序任务流转
- 工序报工、数量累计和状态更新
- 质量检验、NG/不良记录
- 物料、BOM、物料批次和受限的 MRP-lite 展示
- SN 全链路追溯
- 设备状态与 OEE 契约化展示
- 经营驾驶舱、产线/车间钻取和预警中心
- `admin`、`manager`、`operator` 三角色权限和审计日志
- 移动工作台、PWA manifest 和 Service Worker 边界

### AI 增强

- F2 AI 生产日报：产量、完成率、直通率、预警和建议
- F3 智能问数：单日指标和近 7 天趋势查询
- F4 预警根因分析：原因、证据和处置建议
- AI 服务可通过 OpenAI 兼容环境变量接入商业模型；未配置时使用本地规则/抽取模式
- 输出结构校验、数字一致性检查、防幻觉过滤、空白响应降级和敏感信息脱敏

产品边界必须保持清晰：F1 RAG 工艺知识问答尚未作为完整交付能力实现；B14 开放 API 保持未启用；B12 的可用库存、缺料和采购建议字段在数据不足时保持 `null` 并标注受限。不得在演示或验收记录中把这些边界改写为已验收功能。

## 系统结构

```text
Vue 3 + Element Plus + Pinia + Vite
             │ /api/v1
             ▼
NestJS + TypeORM + MySQL 8
             │ 内部 AI 代理
             ▼
FastAPI AI Service
             ├─ 本地规则/抽取模式
             └─ 可选 OpenAI-compatible 模型
```

前端只调用后端 API，不直连 MySQL 或 AI 服务。数据库结构由 `db/schema.sql` 冻结，应用启动时不自动同步表结构。

## 目录说明

```text
backend/                 NestJS 业务 API、认证、事务和单元/e2e 测试
frontend/                Vue 3 Web/PWA、路由、页面、服务和前端测试
ai-service/              FastAPI AI 服务、知识数据和 pytest
db/                      schema.sql、seed.sql 及数据库说明
docs/                    需求、接口契约、操作手册、设计方案和测试报告
docs/handovers/          S1-S12 阶段交接与独立审查记录
scripts/                 受控隔离环境验证脚本
ai-demo/                 AI 演示输入资料
```

## 环境要求

- Node.js 22+
- npm 10
- Python 3.11
- MySQL 8（仅在获授权的隔离环境执行真实数据库验收）
- PowerShell 7（Windows 验证脚本）

所有密码、密钥、Token 只通过进程环境变量注入。不要提交 `.env`，不要在聊天、日志、截图或测试报告中输出完整凭据。

## 本地启动与网站访问

建议按以下顺序启动三个服务。每个服务使用一个 PowerShell 窗口；启动命令默认在项目根目录 `mes-upgrade-starter` 下执行。

| 服务 | 地址 | 用途 |
|---|---|---|
| 前端网站 | `http://localhost:3000` | 登录、驾驶舱、业务模块、移动工作台 |
| 登录入口 | `http://localhost:3000/login` | 进入系统 |
| 移动工作台 | `http://localhost:3000/mobile` | PWA/移动场景展示入口 |
| NestJS API | `http://localhost:3001/api/v1` | 业务接口 |
| FastAPI 文档 | `http://localhost:8000/docs` | AI 服务接口文档 |

启动后，在浏览器地址栏打开 **`http://localhost:3000/login`**；登录成功后从左侧菜单进入驾驶舱、订单、工单、报工、质检、预警、日报、问数、追溯、设备、SPC、MRP 和移动工作台。需要展示移动布局时直接打开 **`http://localhost:3000/mobile`**。

若只需要查看前端页面，仍可先启动前端；需要真实业务请求时必须同时启动后端和 AI 服务，并准备符合项目约束的隔离数据库。没有真实数据库时，不要把页面能打开解释为业务链路已经验收。

### 1. 后端

```powershell
cd backend
Copy-Item .env.example .env
# 按需填写非敏感配置；DB_PASSWORD 通过当前 PowerShell 进程注入
$env:DB_PASSWORD = "<仅在本地输入，不写入文件>"
npm ci
npm run start:dev
```

#### 首次初始化管理员密码

`db/seed.sql` 中的用户密码是占位哈希，不能直接登录。首次使用本机 MySQL 时，先完成表结构和种子数据导入，再在项目根目录运行下面的脚本。脚本会隐藏读取 MySQL 密码和你要设置的管理员密码，只允许把仍是占位哈希的 `admin` 账号初始化为可用的 Argon2id 密码；已有可用密码时会拒绝修改，不会清库或重导数据。

```powershell
.\scripts\bootstrap-admin.ps1
```

初始化后使用用户名 `admin` 和你刚设置的密码登录。登录后进入“用户管理”，由管理员通过 `POST /api/v1/users` 对应的页面创建 `manager` 或 `operator` 账号，并可按需停用账号或调整角色。不要把密码写入 `.env`、命令行参数、日志或 Git。

后端默认监听 `http://localhost:3001`，API 前缀为 `/api/v1`。

### 2. AI 服务

```powershell
cd ai-service
Copy-Item env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

AI 服务未配置商业模型时仍可使用本地模式。模型相关配置见 `ai-service/env.example`，前端不持有 AI Key。

### 3. 前端

```powershell
cd frontend
Copy-Item .env.example .env.development
npm ci
npm run dev
```

开发服务器默认监听 `3000`（如端口被占用，Vite 会提示实际端口）。访问 `/login` 进入登录页，访问 `/mobile` 查看移动工作台路由。演示环境应在界面上保留“演示数据”标识。

### 停止服务

在各服务所在 PowerShell 窗口按 `Ctrl+C`。不要通过删除数据库、清空表或重导数据来停止或重置演示环境。

### 推荐的一键本地启动

为避免后端和 AI 服务的进程令牌不一致，推荐在项目根目录执行：

```powershell
.\scripts\start-local.ps1
```

该脚本只在当前进程内生成随机 `JWT_SECRET` 和 `AI_SERVICE_TOKEN`，分别传递给后端及 AI 服务，不打印、不写入磁盘。脚本启动后，再单独启动前端：

```powershell
cd frontend
npm run dev
```

### 常见启动问题

- **页面可以打开但登录失败**：确认 NestJS 已启动、前端代理端口正确，并检查数据库连接配置；不要把数据库口令写入 README 或提交记录。
- **AI 功能显示本地模式**：这是未配置商业模型时的预期行为，不代表 AI 服务未启动。
- **端口被占用**：关闭占用进程或使用 Vite/NestJS/FastAPI 的显式端口参数，然后同步检查前端代理配置。
- **真实数据库测试失败**：仅在授权隔离库复现并保留不含秘密的日志；不要连接生产库。

## 验证命令

以下命令不需要真实数据库，适合日常回归：

```powershell
# backend
cd backend
npm run test
npm run test:e2e
npm run lint
npm run build
npx tsc --noEmit

# frontend
cd ../frontend
npm run test
npm run typecheck
npm run build

# ai-service
cd ../ai-service
python -m pytest
```

真实 MySQL/JWT 验证只能在获授权隔离库运行：

```powershell
cd ..
.\scripts\verify-s12.ps1 -Database <隔离测试库名>
```

该脚本通过隐藏输入读取数据库口令，并创建带本轮唯一前缀的临时账号后清理；不得把生产库、口令或完整 JWT 传给脚本或写入仓库。缺少数据库 e2e、三角色登录、HS256 校验、停用即时失效、角色即时变化、清理成功中的任一证据，只能记录为“无法验证”。

## 独立审查与开发放行记录

项目采用“执行会话 → 交接文档 → 独立复审 → 放行下一阶段”的门禁流程。执行方自测、截图、模型建议、mock 或数据库替身测试不会被当作真实业务验收。

| 阶段 | 范围 | 独立审查结论 |
|---|---|---|
| S0 | 架构、需求边界、接口契约 | 通过，冻结需求和 API 口径 |
| S1 | MySQL schema、数据边界 | 通过，保留凭据和数据安全边界 |
| S2 | NestJS 后端骨架、健康检查 | 通过，允许进入业务模块 |
| S3 | FastAPI AI 服务 | 通过，确认本地降级和模型边界 |
| S4 | Vue 3 前端骨架 | 通过，允许进入页面和服务开发 |
| S5 | 订单、工单、工序分解 | 通过，核心生产主线可继续开发 |
| S6 | 报工、质量检验 | 通过，确认数量和 NG 记录边界 |
| S7 | 驾驶舱、预警、事务一致性 | 代码复审通过；事务异常传播和边界已修复 |
| S8 | AI 日报、预警根因 | 代码复审通过；结构校验、防幻觉、脱敏和降级已覆盖 |
| S9 | 智能问数、RAG 接入 | 代码复审通过；查询边界和取消语义已覆盖 |
| S10 | 物料、SN、设备、权限审计 | 代码复审通过；认证实现边界记录在交接文档 |
| S11 | SPC、MRP-lite、PWA、开放 API | 代码复审通过；受限字段和未启用 API 明确标识 |
| S12 | 联调终验、展示和收尾文档 | 代码复审及自动化回归通过；真实环境验收待授权 |

### S12 独立回归证据

证据来自临时副本，未修改原项目、未导入 DDL、未清理既有业务数据：

| 检查 | 结果 | 证据性质 |
|---|---:|---|
| 后端单元测试 | 45 文件 / 411 项通过 | 独立临时副本 |
| 后端无库 HTTP e2e | 5 文件 / 60 项通过 | 独立临时副本；出现 127.0.0.1:3306 拒绝日志，不是真实数据库通过 |
| 后端 lint | 通过，4 个既有 warning | 独立静态检查 |
| 后端 TypeScript | 通过 | 独立静态检查 |
| 前端测试 | 31 文件 / 307 项通过 | 独立临时副本；存在既有 Vue warning |
| 前端 typecheck | 通过 | 独立静态检查 |
| 前端生产构建 | 通过 | 独立构建检查，存在 bundle size warning |
| AI 服务 pytest | 61 项通过（此前独立审查记录） | 历史独立临时副本证据；本轮环境因虚拟环境未安装 `pytest`，未能重新执行 |
| PWA manifest、`/mobile`、Service Worker 边界 | 通过 | 静态边界检查 |

完整证据、命令上下文和未验证项见：

- `docs/handovers/s1-s7-review-summary.md`
- `docs/handovers/s8-ai-reports-root-cause.md`
- `docs/handovers/s9-ai-query-dialogue.md`
- `docs/handovers/s10-materials-trace-devices-auth-audit.md`
- `docs/handovers/s11-spc-mrp-pwa-open-api.md`
- `docs/handovers/s12-final-acceptance.md`
- `docs/handovers/s12-demo-guide.md`

本表严格区分“历史独立证据”和“本轮新鲜命令结果”。执行方在交接文档中声明的自测统计不会自动升级为本轮独立实测；缺少可重现命令输出的项目仍按未重新验证处理。

## 展示建议

按“厂长的一天”演示：

1. 登录后查看 AI 生产日报（F2），确认所有数字带演示数据标识。
2. 从日报预警进入预警中心，查看 F4 根因、证据和处置建议。
3. 使用 F3 查询当天指标和近 7 天趋势。
4. 切换到订单 → 工单 → 工序 → 报工 → 质量检验，展示主线数据联动。
5. 查看 SN 追溯、设备状态、SPC、MRP-lite 和移动工作台。
6. 需要真实环境验证的项目单独记录为“待验收”，不要在演示中宣称已通过。

## 安全与数据边界

- 禁止提交 `.env`、数据库口令、JWT secret、AI Key、完整 Token、生产数据和未脱敏截图。
- 真实数据库测试只使用获授权的隔离库；不清表、不重导、不修改既有业务数据。
- 演示数据与生产数据必须可区分；业务验收使用脱敏数据或只读副本。
- JWT 的 HS256、issuer、audience、有效期和当前账号状态读取规则见 S12 交接文档；代码实现通过不等于真实数据库登录链路已验收。
- 发现安全问题请不要公开发布凭据，先在私有渠道提供最小复现信息。

## 后续验收流程

1. 技术人员在授权隔离库运行 `scripts/verify-s12.ps1`，留存不含秘密的结果。
2. 技术人员使用 Chrome、Edge 和真实 Android/iOS 设备完成 DOM、登录、PWA 安装、扫码、断网/恢复测试。
3. 业务负责人按需求规格说明书逐项验收订单、工单、报工、检验、预警、AI、SPC、MRP 和移动工作台。
4. 生产数据在脱敏或只读副本上验收，确认备份、回滚、监控和发布窗口。
5. 业务、技术和运维责任人分别签字后，组织才可决定是否上线。

## 许可与使用

本项目面向精创电子 MES + AI 项目演示和内部开发流程。数据库样例、企业资料和演示数据按项目授权使用；未经授权不得用于生产部署或对外分发。正式开源许可、商标和数据授权应由项目负责人另行确认。
