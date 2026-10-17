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
- MySQL 8（本地运行所需；验收测试使用获授权的隔离库）
- Git（通过命令行克隆仓库时需要）
- PowerShell 7（Windows 验证脚本）

启动器通过进程环境变量向服务注入口令、密钥和令牌；本地数据库口令的保存方式见下文。不要提交 `.env`，不要在日志、截图或测试报告中输出完整凭据。

## 安装与启动（Windows）

以下步骤使用 **PowerShell 7**（命令为 `pwsh`），不适用于 CMD 或 Windows PowerShell 5.1。启动器面向本地开发环境，不作为生产部署方案。

### 1. 获取项目

打开 PowerShell 7，在希望保存项目的目录执行：

```powershell
git clone https://github.com/ShengHR-hub/mes-upgrade-starter.git
Set-Location .\mes-upgrade-starter
```

后续安装与启动命令均在**项目根目录**执行，即包含 `backend`、`frontend`、`ai-service`、`db` 和 `scripts` 的目录。已下载项目的读者无需再次克隆，可在文件资源管理器中打开项目文件夹，在地址栏输入 `pwsh` 并回车，以该目录打开 PowerShell 7。

### 2. 安装依赖

先安装「环境要求」中列出的工具，并确认 MySQL 服务正在运行。

```powershell
npm --prefix .\backend ci
npm --prefix .\frontend ci
py -3.11 -m venv .\ai-service\.venv
.\ai-service\.venv\Scripts\python.exe -m pip install -r .\ai-service\requirements.txt
```

### 3. 配置数据库连接

复制配置模板；已有配置文件不会被覆盖：

```powershell
if (-not (Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
if (-not (Test-Path .\frontend\.env.development)) { Copy-Item .\frontend\.env.example .\frontend\.env.development }
notepad .\backend\.env
```

按实际环境设置 `DB_HOST`、`DB_PORT`、`DB_USERNAME` 和 `DB_DATABASE`。默认目标为 `127.0.0.1:3306` 的 `smart_mes`。`DB_PASSWORD` 留空，使用下面的本地隐藏输入窗口保存数据库口令：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\input-db-password.ps1
```

输入的是 **MySQL 连接账号的密码**，不是 MES 网站密码。口令持久保存在当前 Windows 用户的环境变量 `MES_DB_PASSWORD` 中（用户注册表），这不是加密凭据库。数据库密码变化后需重新运行该命令。

AI 服务不读取 `.env`。启动器生成并注入后端与 AI 服务共享的令牌，以及 JWT 签名密钥；重启后需重新登录。未配置商业模型时使用本地规则/抽取模式。

### 4. 初始化数据库与管理员（仅首次安装）

启动器不会创建数据库或自动同步表结构。数据库结构见 [db/schema.sql](db/schema.sql)，基础数据见 [db/seed.sql](db/seed.sql)。**`seed.sql` 含清表操作，仅限全新、可丢弃的开发数据库；已有数据的数据库不得重导。** 接入已有数据库时，应先核对表结构，跳过初始化导入。

在全新开发库中，可使用 MySQL 客户端加载这两个 SQL 文件。若使用命令行，先在项目根目录运行 `mysql -h 127.0.0.1 -P 3306 -u root -p`，按实际配置替换连接参数，并在交互提示中输入密码。以下语句在 **MySQL 客户端**中执行；文件路径使用项目所在位置的绝对路径和正斜杠，例如：

```sql
SOURCE C:/projects/mes-upgrade-starter/db/schema.sql;
USE smart_mes;
SOURCE C:/projects/mes-upgrade-starter/db/seed.sql;
```

`C:/projects/mes-upgrade-starter` 为示例路径，执行前必须替换。导入前检查 SQL 中的目标库名与连接配置一致。输入 `exit` 退出 MySQL 客户端，返回 PowerShell。

种子数据中的用户密码为占位哈希，不能直接登录。在项目根目录执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-admin.ps1
```

按隐藏输入提示，分别输入 MySQL 密码和要设置的 MES 管理员密码。脚本仅初始化仍使用占位哈希的 `admin` 账号；已有可用密码时会拒绝修改。管理员密码不应写入命令参数、配置文件、日志或 Git。

### 5. 启动服务（日常使用）

完成首次配置后，日常只需确保 MySQL 服务运行，并在**项目根目录的 PowerShell 7**中执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
```

若终端位于其他目录，可改用脚本的完整路径。例如项目保存于 `C:\projects\mes-upgrade-starter` 时：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File 'C:\projects\mes-upgrade-starter\scripts\dev-up.ps1'
```

完整路径必须替换为实际项目路径。`-ExecutionPolicy Bypass` 仅作用于本次脚本进程，不改变永久执行策略。

启动器自动打开后端、AI 和前端三个服务窗口；保持这些窗口运行，无需再分别启动服务。待原窗口恢复 PowerShell 提示符后，执行：

```powershell
Get-Content "$env:TEMP\mes-dev-status.txt"
```

以下结果表示三个服务健康检查通过：

```text
BACKEND_HEALTH_HTTP 200
AI_HEALTH_HTTP 200
FRONTEND_LOGIN_HTTP 200
OVERALL OK
DONE
```

出现 `timeout` 或 `OVERALL FAILED` 时，查看对应服务窗口的错误信息。健康检查通过表示服务可达，不等于完整业务验收通过。

### 6. 访问网站与创建用户

打开 [MES 登录页面](http://localhost:3000/login)，使用 `admin` 和初始化时设置的 MES 管理员密码登录。登录是校验已有密码，不会创建账号或设置新密码。

系统面向内部用户，不提供公开注册。管理员登录后，从「用户管理」创建 `manager` 或 `operator` 账号并分配权限。其他用户使用管理员分配的账号密码登录。

| 服务 | 地址 | 用途 |
|---|---|---|
| 前端网站 | http://localhost:3000 | 驾驶舱与业务模块 |
| 登录入口 | http://localhost:3000/login | 账号登录 |
| 移动工作台 | http://localhost:3000/mobile | 移动布局与 PWA 入口 |
| NestJS API | http://localhost:3001/api/v1 | 业务接口 |
| FastAPI 文档 | http://localhost:8000/docs | AI 服务接口文档 |

`localhost` 指运行服务的主机。开发配置绑定本机地址，其他电脑或手机不能用自己的 `localhost` 访问该主机；局域网访问需要另行配置监听地址、网络和访问控制。

仓库配套演示过程数据的日期范围为 **2026-10-10 至 2026-10-16**。使用该批数据展示日报或趋势时，应选择对应历史日期；当日没有报工时，零值或无数据属于正常结果。

### 停止与重启

在三个服务窗口中分别按 `Ctrl+C` 停止服务。关闭浏览器不会停止服务。再次启动或重启时执行第 5 步的启动命令；启动器只尝试停止可识别为本项目的端口进程。日常启动无需重复安装依赖、导入数据库或初始化管理员。

### 常见问题

| 问题 | 排查方法 |
|---|---|
| 找不到 `pwsh` | 安装 PowerShell 7，并重新打开终端。 |
| 找不到脚本 | 在项目根目录执行相对路径命令，或使用实际脚本的完整路径；不要从其他目录直接执行 `.\scripts\...`。 |
| `MES_DB_PASSWORD is not set` | 执行第 3 步的隐藏输入脚本，保存 MySQL 口令后重新启动。 |
| 后端健康检查超时 | 核对 MySQL 服务、连接参数、口令和表结构，并查看后端窗口。 |
| AI 健康检查超时 | 确认 `.venv` 已创建且已安装 `requirements.txt`。 |
| 页面可打开但登录失败 | 核对后端与数据库状态；首次安装需完成管理员初始化。已有账号应使用原密码。 |
| AI 显示本地模式 | 未配置商业模型时的预期行为。 |
| 端口被占用 | 核对占用程序后处理。前端固定使用 3000，冲突时不会自动切换；不要随意结束其他程序。 |

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
