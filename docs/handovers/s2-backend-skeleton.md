# 交接文档 — S2 NestJS 后端骨架 — 2026-10-10

> **状态：已完成 → 审查问题（P1×1 + P2×4）第二轮修复 → 复审遗留的 `skip` 越界 1 项第三轮修复；
> 全部问题已闭环（2026-10-10），待复审。**
> `backend/` 骨架建成：NestJS 12 + TypeORM 1.1 已连上 `smart_mes`；
> 契约 §2 的全局规范（统一包体 / 错误码表 / 分页 / BIGINT 转字符串 / 拒绝未知字段 / `X-Request-Id`）
> 现已全部落地 —— ⚠️ **首轮交付时「拒绝未知字段」与「`X-Request-Id`」两项实际未实现，
> 首轮本文档的相关表述不准确，系审查发现后于第二轮补齐，详见 §7。**
> `GET /health` 与 `GET /api/v1/health` 实测返回 `code 0`，数据库连通性 `up`（MySQL 8.4.9）。
> **不写任何业务接口**（订单/工单等属 S5），未改动表结构。

---

## 1. 本会话做了什么

在 `mes-upgrade-starter/backend/` 用 `npx @nestjs/cli new` 生成 NestJS 骨架，安装
`@nestjs/typeorm` / `typeorm` / `mysql2` / `@nestjs/config`，把 TypeORM 指向
`smart_mes @ 127.0.0.1:3306`（凭据走 `.env`，已加入 `.gitignore`）。

按 `docs/api-contract.md` §2 实现全局规范：统一返回包体 `{code,message,data}`、
契约 §3 全量错误码表、分页 `{list,total,page,pageSize}`、BIGINT→十进制字符串。
新增健康检查模块，服务监听 3001，`/health` 实测通过。

> ⚠️ **首轮范围声明修正**：契约 §2 的另外两项 —— **「所有请求拒绝未知字段」**（§2.1）与
> **`X-Request-Id` 追踪头**（§2.2）—— 首轮**未实现**，本文档首版却表述为"全局规范全部落地"，
> 属描述与实现不一致。该两项已于第二轮修复（见 §7），当前实现已与描述一致。

---

## 2. 文件清单

### 新增（业务代码与配置）

| 文件 | 作用 |
|---|---|
| `backend/.env` | 真实连接凭据（**已 gitignore，不提交**） |
| `backend/.env.example` | 配置模板（可提交） |
| `backend/.gitignore` | 排除 `node_modules/` `dist/` `.env` `*.log` 等 |
| `backend/src/main.ts` | 启动入口，监听 3001 |
| `backend/src/bootstrap.ts` | 应用级横切配置（启动与 e2e 共用） |
| `backend/src/app.module.ts` | 根模块：ConfigModule + TypeOrmModule + HealthModule |
| `backend/src/config/typeorm.config.ts` | TypeORM 连接选项工厂 |
| `backend/src/config/snake-naming.strategy.ts` | camelCase 属性 ↔ snake_case 列映射 |
| `backend/src/common/constants/error-code.ts` | 契约 §3 全量错误码表 + HTTP 映射 |
| `backend/src/common/dto/api-response.ts` | `ApiResponse<T>` / `PageResult<T>` / `FieldError` |
| `backend/src/common/dto/pagination.ts` | 分页归一化（默认 1/20，范围 1~100） |
| `backend/src/common/exceptions/business.exception.ts` | 承载契约错误码的业务异常 |
| `backend/src/common/filters/all-exceptions.filter.ts` | 全局异常过滤器 |
| `backend/src/common/interceptors/transform.interceptor.ts` | 统一返回包体 |
| `backend/src/common/interceptors/bigint-serializer.interceptor.ts` | BIGINT 出口序列化 |
| `backend/src/common/utils/bigint.util.ts` | `bigint` 递归转字符串 |
| `backend/src/common/utils/datetime.util.ts` | 业务时区（+08:00）RFC 3339 格式化 |
| `backend/src/modules/health/health.module.ts` | 健康检查模块 |
| `backend/src/modules/health/health.controller.ts` | `GET /health`、`GET /api/v1/health` |
| `backend/src/modules/health/health.service.ts` | 服务状态 + `SELECT 1` 探测 |
| `backend/src/modules/health/health.types.ts` | 健康检查响应类型 |
| `backend/src/common/dto/pagination.spec.ts` | 分页单测（首轮 5 例 → 第二轮 18 例） |
| `backend/src/common/utils/bigint.util.spec.ts` | BIGINT 单测（4 例） |
| `backend/src/common/utils/datetime.util.spec.ts` | 时间格式化单测（3 例） |
| `backend/src/common/middleware/request-id.middleware.ts` | `X-Request-Id` 生成/回写 + 请求日志（**第二轮新增**） |
| `backend/src/common/pipes/create-validation.pipe.ts` | 全局 ValidationPipe：拒绝未知字段 → 10001（**第二轮新增**） |
| `backend/src/common/dto/pagination-query.dto.ts` | 分页查询 DTO：类型/字面量第一道校验（**第二轮新增**） |
| `backend/src/modules/health/health-query.dto.ts` | 健康检查空 DTO，用于拒绝未知字段（**第二轮新增**） |

### 修改

| 文件 | 变更 |
|---|---|
| `backend/test/app.e2e-spec.ts` | 由脚手架 "Hello World" 改为健康检查 e2e（首轮 5 例 → 第二轮 8 例，用 mock DataSource，不依赖 MySQL） |
| `backend/src/bootstrap.ts` | 第二轮：注册 `requestIdMiddleware` 与全局 `ValidationPipe` |
| `backend/src/config/typeorm.config.ts` | 第二轮：`synchronize` 写死 `false`，移除环境变量覆盖，新增启动闸门 |
| `backend/src/common/dto/pagination.ts` | 第二轮：分页参数改为严格校验 |
| `backend/src/common/filters/all-exceptions.filter.ts` | 第二轮：5xx 统一安全文案 + 日志脱敏 + 关联 `X-Request-Id` |
| `backend/src/modules/health/health.controller.ts` | 第二轮：`@Query()` 绑定 `HealthQueryDto` |
| `backend/.env` / `backend/.env.example` | 第二轮：移除 `DB_SYNCHRONIZE`，改为注释说明同步已写死关闭 |

### 删除

| 文件 | 原因 |
|---|---|
| `backend/src/app.controller.ts` / `app.service.ts` / `app.controller.spec.ts` | 脚手架自带 `GET /` 返回 `Hello World!`，**不在契约路径内**；按契约 §2.1「所有业务路径以 `/api/v1` 开头」移除，避免留下非契约路由 |

> 未改动：`db/schema.sql`、`db/seed.sql`、`data/*.xlsx`、`docs/api-contract.md`、`docs/开发操作指导手册.md`。

---

## 3. 接口清单（本模块新增/实现的 API）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 运维健康检查：服务状态 + 数据库连通性（`SELECT 1`） |
| GET | `/api/v1/health` | 同上，与契约 `/api/v1` 前缀一致的版本化入口 |

**为什么注册两个路径**：任务要求同时提供 `/api/v1/health`（契约前缀）与
`http://localhost:3001/health`（运维探针）。`api-contract.md` §8 明确
「启动说明的 `/health` 为运维检查，不替代本契约路由」，故用
`@Controller(['health','api/v1/health'])` 同时暴露，**未使用 `setGlobalPrefix`**。

**响应示例**（实测原文）：

```json
{"code":0,"message":"成功","data":{"status":"ok","service":"mes-backend","version":"0.0.1","uptimeSeconds":2,"timestamp":"2026-10-10T01:47:30.538+08:00","database":{"status":"up","latencyMs":1,"version":"8.4.9"}}}
```

数据库不可用时按契约 §3 返回 `HTTP 503 / code 50002`，且**不泄露原始错误文本**。

---

## 4. 自测结果

环境：pwsh **7.6.6**；Node **v22.22.2**（managed）；npm **10.9.7**；MySQL **8.4.9** @ 127.0.0.1:3306。

### 4.1 构建与测试

| # | 命令（pwsh 7 实际执行） | 结果（首轮） | 修复后 |
|---|---|---|---|
| 1 | `npm run build`（nest build） | **exit 0**，`Found 0 errors`，产出 `dist/main.js` | **exit 0** |
| 2 | `npm test`（vitest run） | **exit 0**，3 文件 / **12 例全通过** | **exit 0**，3 文件 / **30 例全通过** |
| 3 | `npm run test:e2e`（vitest，mock DataSource） | **exit 0**，1 文件 / **5 例全通过** | **exit 0**，1 文件 / **8 例全通过** |

> 审查修复（第二、三轮）的完整逐项实测记录见 **§7.3**（含 §7.3.1）。

### 4.2 `/health` 实测（原生 curl 原文）

命令：`npm run start:dev`（`nest start --watch`，编译 0 错误）

```http
$ curl -i http://localhost:3001/health
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"code":0,"message":"成功","data":{"status":"ok","service":"mes-backend","version":"0.0.1","uptimeSeconds":2,"timestamp":"2026-10-10T01:47:30.538+08:00","database":{"status":"up","latencyMs":1,"version":"8.4.9"}}}
```

```http
$ curl -i http://localhost:3001/api/v1/health
HTTP/1.1 200 OK

{"code":0,"message":"成功","data":{"status":"ok","service":"mes-backend","version":"0.0.1","uptimeSeconds":2,"timestamp":"2026-10-10T01:47:30.560+08:00","database":{"status":"up","latencyMs":1,"version":"8.4.9"}}}
```

**错误包体抽查**（验证统一错误码表生效）：

```http
$ curl -i http://localhost:3001/api/v1/unknown
HTTP/1.1 404 Not Found

{"code":30001,"message":"资源不存在","data":null}
```

启动日志确认路由注册：

```
[RouterExplorer] Mapped {/health, GET} route
[RouterExplorer] Mapped {/api/v1/health, GET} route
[Bootstrap] MES backend 已启动：http://localhost:3001
```

自测后已 `taskkill` 结束进程树，端口 3001 已释放（复测 `TcpClient.Connect` = False）。

### 4.3 依赖版本（实测）

| 包 | 版本 |
|---|---|
| @nestjs/core / common | 12.1.2 |
| @nestjs/typeorm | 12.0.2 |
| typeorm | **1.1.2**（不是 0.3.x，见 §5） |
| mysql2 | 3.24.5 |
| @nestjs/config | 12.0.1 |
| @nestjs/cli | 12.0.8 |
| typescript | 6.0.3 |
| vitest | 4.1.11 |

---

## 5. 已知问题 / 待办

### 5.1 环境坑（**后续会话必读**）

- [ ] **npm 安装必须加 `--legacy-peer-deps`。** npm 10.9.7 在本依赖树上会崩：
  `npm error Cannot read properties of null (reading 'edgesOut')`
  （栈顶 `@npmcli/arborist/lib/arborist/build-ideal-tree.js` 的 `#loadPeerSet`）。
  清缓存、删 `package-lock.json` 均无效；加 `--legacy-peer-deps` 后正常。
  影响：`npx @nestjs/cli new` 内置的 `npm install --silent` 会失败（骨架文件仍会生成），
  需手动补装。**后续会话装任何新依赖都请带上该参数。**
- [ ] **EBADENGINE 警告（可忽略）**：`@angular-devkit/*@22.2.0` 要求 node `^22.22.3`，
  本机为 `22.22.2`。仅警告，构建/测试/运行均正常。若要消除，可 `install_binary` 升到 22.22.3+。
- [ ] 本机 5 个 MySQL 实例仅 `MySQL841` 运行，连接必须显式 `127.0.0.1:3306`。

### 5.2 本模块遗留

- [x] ~~未安装 `class-validator` / `class-transformer`，未启用全局 `ValidationPipe`~~
  → **已修复（2026-10-10 第二轮）**：已装 `class-validator@0.15.1` / `class-transformer@0.5.1`，
  全局启用 `whitelist + forbidNonWhitelisted + transform`，未知字段统一返回 10001。见 §7。
- [x] ~~未实现 `X-Request-Id` 响应头~~ → **已修复（2026-10-10 第二轮）**：
  由 `requestIdMiddleware` 为每个请求生成/沿用 requestId，写入响应头与日志。见 §7。
- [ ] **未启用 CORS**。契约 §2.1 要求前端经同源代理访问，故默认不开放跨域；S4 前端请配 Vite proxy。
- [ ] **未做 JWT / RBAC / 审计**（契约 §5，属 B9，S10）。当前所有接口无鉴权，仅 `/health` 是公开运维接口。
- [ ] **数据库不可用时应用启动会失败**（`TypeOrmModule` 默认 fail-fast，重试 5 次 × 2s）。
  `/health` 的 `database.status:down` 分支只在**运行期掉线**时才会被观察到。
  若后续要求"库挂了服务仍能起来并报告 degraded"，需改为手动管理 `DataSource`（本会话未做，属设计决策）。
- [ ] `retryAttempts` / `retryDelay` 目前硬编码在 `typeorm.config.ts`（5 / 2000ms），
  如需可配置再迁到 `.env`。
- [ ] **5xx 的 `data` 保留规则**：`AllExceptionsFilter` 对 5xx 强制安全文案；`data` 仅当
  `BusinessException` 显式提供业务级诊断数据时才保留（如 `/health` 的组件状态），否则置 null。
  后续模块若要在 5xx 里回传诊断信息，必须走 `BusinessException` 且确认不含敏感内容。
- [ ] **凭据**：MySQL 口令**不落盘**（2026-10-10 统一口径，见下方「凭据口径变更」）。**本交接文档不含任何口令**。

> ### 凭据口径变更（2026-10-10，由 S3 复审会话统一处理）
>
> 原口径「口令只写入 `backend/.env`」已废止：**全项目密码/密钥/Token 一律不落盘，只从进程环境变量读取**。
>
> - `backend/.env` 的 `DB_PASSWORD` 已**清空**（原值已删除）；`backend/.env.example` 同步改为空值 + 注入说明。
> - 启动方式改为按会话注入：
>   ```powershell
>   cd mes-upgrade-starter\backend
>   $env:DB_PASSWORD = "<口令>"; npm run start:dev
>   ```
>   `@nestjs/config` 默认不覆盖已存在的 `process.env`，故注入值优先于 `.env`，无需改代码。
> - 未注入时后端连库会报认证失败，属预期行为。
> - 同时清理：`db/seed_from_excel.py` 注释中的明文初始口令；`data/05_人员账号.xlsx` 与两份 `knowledge.json` 的明文初始口令列/文本已脱敏为 `<首登强制修改>`。
> - **仍存留**：根目录 `企业数据文件/05_人员账号.xlsx`（企业原始素材，用户决定保留原件）。
  S1 遗留的"root 为 6 位纯数字弱口令"建议在验收后更换。

### 5.3 与契约的差异说明（供审查确认）

1. **未使用 `setGlobalPrefix('api/v1')`**，而是让控制器显式声明完整路径。
   原因：需同时暴露 `/health`（运维）与 `/api/v1/health`（契约）。
   **S5 起新增业务控制器请写成 `@Controller('api/v1/orders')` 形式。**
2. **`SnakeNamingStrategy` 已启用**：实体属性写 camelCase，TypeORM 自动映射为 snake_case 列；
   显式 `@Column({name:'xxx'})` / `@Entity('xxx')` 仍优先。配合 `synchronize: false`，
   **不会对已定稿表结构产生任何变更**。
3. **`dateStrings` 未开启**：DATE/TIMESTAMP 仍由驱动返回 `Date` 对象，
   格式化到 `YYYY-MM-DD` / RFC 3339 属 DTO 层职责，留待业务会话（`datetime.util.ts` 已备好工具）。

---

## 6. 给下个会话的提示

**S3（FastAPI AI 服务）/ S4（Vue3 前端）/ S5（B1 订单 + B2 工单）需要知道：**

1. **启动方式**
   ```powershell
   cd mes-upgrade-starter\backend
   npm run start:dev     # nest start --watch，监听 http://localhost:3001
   ```
   首次运行前确认 `backend/.env` 存在（照 `.env.example` 填）；`.env` 不入库。
   装依赖一律 `npm install --legacy-peer-deps <pkg>`。
2. **技术栈注意点（与常见 Nest 教程不同）**
   - **ESM 工程**：`package.json` 有 `"type":"module"`，**本地相对导入必须写 `.js` 后缀**
     （如 `import { HealthService } from './health.service.js'`）。
   - **测试用 vitest**（不是 jest）：单测 `*.spec.ts`、e2e `*.e2e-spec.ts`，
     `describe/it/expect` 为全局变量。
   - **TypeORM 是 1.1.x**（不是 0.3.x）：MySQL 选项类型叫 `MysqlDataSourceOptions`；
     `DataSource` 仍是核心入口。写实体前先 `node_modules/typeorm` 里核一下签名。
3. **要复用而不是重写的全局规范**
   - 返回值直接 `return` 业务数据即可，`TransformInterceptor` 会自动包成 `{code,message,data}`；
     若要自定义 `message`，用 `ok(data, message)`。
   - 抛错一律 `throw new BusinessException(ErrorCode.XXX, '自定义文案', data?)`，
     HTTP 状态由 `ERROR_CODE_HTTP_STATUS` 自动推导，**不要手写状态码**。
   - 分页统一用 `normalizePagination(query)` 拿 `{page,pageSize,skip,take}`，
     返回用 `page(list, total, pageNo, pageSize)`；query DTO 复用 `PaginationQueryDto`，
     **不要绕过 `normalizePagination` 直接读 DTO 字段**（范围与安全整数校验都在它里面）。
   - **每个接口都必须声明 query / body DTO**：全局 ValidationPipe 已开
     `whitelist + forbidNonWhitelisted`；没有 DTO 的参数不会被校验，有 DTO 时未知字段自动 10001。
   - `X-Request-Id` 已由中间件统一注入（含 404 响应），业务代码无需处理；
     需要关联日志时读 `req.requestId`。
   - BIGINT 已双保险（驱动 `bigNumberStrings` + 拦截器），实体主键按 `string` 声明即可。
4. **先看这几个文件**：`docs/api-contract.md` §2/§3/§4、`docs/handovers/s1-db.md`、
   `backend/src/common/constants/error-code.ts`、`backend/src/bootstrap.ts`、
   `backend/src/common/pipes/create-validation.pipe.ts`、`backend/src/config/typeorm.config.ts`。
5. **S5 特别注意**：表结构 18 张已定稿（`db/schema.sql`）；**`synchronize` 已在
   `typeorm.config.ts:56` 写死为 `false`，且不可用环境变量覆盖**（误设 `DB_SYNCHRONIZE=true`
   会导致启动直接报错退出）——不要试图"临时打开同步"。
   `product`/`device`/`material` 主键是字符串 `code`，不是 BIGINT。

---

## 7. 审查修复记录（P1×1 + P2×4 + 复审补充 1）— 2026-10-10 第二轮 / 第三轮

> 承接 S2 审查报告。**只修问题，不加功能，不改表结构**；合法请求的原有行为保持不变。
> **第二轮**：修复审查报告列出的 5 项。
> **第三轮**：修复复审遗留的 `skip` 计算越界 1 项（见 §7.2 末条、§7.6）。

### 7.1 本会话做了什么

按严重程度逐项修复审查报告的 5 个问题：把 `synchronize` 写死并加启动闸门（P1）、
5xx 统一安全文案（P2）、补 `X-Request-Id`（P2）、全局启用 ValidationPipe 拒绝未知字段（P2）、
分页参数严格校验（P2）。全部修复均逐项实测（非仅单测），未新增任何业务接口。

### 7.2 逐项修复说明（文件 + 行号 + 改了什么）

#### P1 禁止自动改表未被强制保证 → 已修复

文件：`backend/src/config/typeorm.config.ts`

- **L56**：`synchronize: false` **写死**（原为 `toBoolean(config.get<string>('DB_SYNCHRONIZE'), false)`，
  存在被环境变量打开的风险）。
- **L21–L30 新增 `assertSynchronizeDisabled()`**：启动时若检测到 `DB_SYNCHRONIZE` 为启用值
  （`1/true/yes/on`，忽略大小写与首尾空白），**直接抛错终止启动**；错误文案带 `[FATAL]` 前缀与处理指引。
  在 `buildTypeOrmOptions()` 首行调用（L37），处于 NestJS 模块初始化阶段，因此进程不会起来。
- **L57**：`migrationsRun: false` 保持写死。
- `backend/.env`、`backend/.env.example`：**删除 `DB_SYNCHRONIZE` 变量**，改为注释说明同步已写死关闭。

#### P2 HTTP 500 可能泄露内部信息 → 已修复

文件：`backend/src/common/filters/all-exceptions.filter.ts`

- `catch()` 末尾新增 5xx 分支：**HTTP ≥ 500 时 message 强制取错误码表安全文案**
  （50001→"服务器内部错误"、50002→"依赖服务不可用"、50003→"依赖服务超时"），
  不再回显异常原文、内部标记或堆栈。
- `data` 规则：5xx 默认置 `null`；**仅当 `BusinessException` 显式提供了业务级诊断数据时保留**
  （如 `/health` 的依赖组件状态），避免误伤既有运维语义。
- 日志脱敏：改用 `request.path`（**不含 query string**，避免 URL 中的敏感参数入日志），
  日志前缀加 `[<requestId>]` 便于关联。
- **4xx 行为完全不变**：仍使用契约中文标准文案，业务自定义文案（非框架默认英文）照常透出。

#### P2 缺少 X-Request-Id 响应头 → 已修复

文件：新增 `backend/src/common/middleware/request-id.middleware.ts`；修改 `backend/src/bootstrap.ts`

- 中间件对每个请求：沿用客户端传入的**合法** `X-Request-Id`（`^[A-Za-z0-9._-]{1,128}$`），
  否则生成 `randomUUID()`；写入 `req.requestId`、回写响应头、记录一条 `[HTTP]` 请求日志。
- 用 `app.use()` 挂在 Express 层（**先于路由匹配**），因此 **404 响应同样带头**。
  本项目是 **Express 5.2.1**，故未使用 `forRoutes('*')`，规避 Express 5 通配符语法变更。
- `bootstrap.ts`：`configureApp()` 中 `app.use(requestIdMiddleware)`。

#### P2 "拒绝未知字段"未落实 → 已修复

文件：新增 `src/common/pipes/create-validation.pipe.ts`、`src/common/dto/pagination-query.dto.ts`、
`src/modules/health/health-query.dto.ts`；修改 `src/bootstrap.ts`、`src/modules/health/health.controller.ts`

- 安装 `class-validator@0.15.1` + `class-transformer@0.5.1`（`--legacy-peer-deps`）。
- 全局 `ValidationPipe`：`whitelist: true`、`forbidNonWhitelisted: true`、`transform: true`；
  自定义 `exceptionFactory` 将校验错误转成 `BusinessException(10001)`，响应体严格为
  `{"code":10001,"message":"参数错误","data":{"errors":[{"field":…,"reason":…}]}}`
  （whitelist 命中的 reason 统一为"未知字段，请求被拒绝"，不泄露框架英文原文）。
- 健康检查新增空 DTO `HealthQueryDto` 并绑定 `@Query()`，使 `/health` 也纳入未知字段校验。

#### P2 分页参数类型与精度漏洞 → 已修复

文件：`backend/src/common/dto/pagination.ts`

- 新增 `UNSIGNED_INTEGER_PATTERN = /^\d+$/` 与 `parseUnsignedInteger()`，三重校验：
  1. **类型**：只接受 `string` / `number`，数组、对象一律拒绝；
  2. **字面量**：必须匹配 `/^\d+$/`（拒绝 `abc`、`-1`、`+1`、`1.5`、`1e3`、`0x10`、含空格）；
  3. **范围**：`Number.isSafeInteger()` 拒绝 `9007199254740993` 这类静默丢精度的巨值，
     再校验 `page ≥ 1`、`pageSize ∈ [1,100]`。
- 不合法一律抛 10001，**不再静默转换、不再静默截断**；合法输入行为不变。
- 配套 `PaginationQueryDto` 提供类型/格式的第一道校验（`@IsString` + `@Matches`）。

#### P2 分页 `skip` 计算结果越界（复审补充）→ 已修复（2026-10-10 第三轮）

文件：`backend/src/common/dto/pagination.ts`（`normalizePagination()` 末尾）

- **问题**：`page` 与 `pageSize` 各自都通过安全整数校验，但**相乘后仍可能越界**。
  例如 `page=9007199254740991`（`Number.MAX_SAFE_INTEGER`，本身合法）+ `pageSize=100`（合法）
  → `skip = 900719925474099000`，远超安全整数范围，会被静默丢精度，
  把查询指到一个"看起来合法"的错误分页位置。原实现直接
  `return { …, skip: (page - 1) * pageSize, … }`，未校验计算结果。
- **修复**：先把 `skip` 算出来，再用 `Number.isSafeInteger(skip)` 校验；
  越界即抛 `10001`，`data.errors = [{field:'page', reason:'page 与 pageSize 组合计算出的偏移量超出安全整数范围'}]`。

  ```ts
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip)) {
    throw invalid('page', 'page 与 pageSize 组合计算出的偏移量超出安全整数范围');
  }
  return { page, pageSize, skip, take: pageSize };
  ```

- **回归测试**：`src/common/dto/pagination.spec.ts` 新增 `describe('skip 计算结果越界…')` 共 **6 例**：
  越界（`pageSize=20/2/100`）+ 边界合法（`pageSize=1` 时 `page=MAX_SAFE_INTEGER`；
  `pageSize=100` 时最大合法 `page=90071992547410`）+ 边界 +1 越界（`page=90071992547411`）。
- **合法边界（已用 Node 独立复算确认）**：
  - `pageSize=1`：`page=9007199254740991` → `skip=9007199254740990`（安全）
  - `pageSize=100`：`page=90071992547410` → `skip=9007199254740900`（安全，最大合法）
  - `pageSize=100`：`page=90071992547411` → `skip=9007199254741000`（越界）

### 7.3 验证结果（逐项实测）

命令一律在 **pwsh 7.6.6** 下执行；服务以 `npm run start:dev` 启动；HTTP 用原生 `curl` 实测。

| # | 验证项 | 结果 | 实测证据 |
|---|---|---|---|
| 1 | `npm run start:dev` 正常启动 | ✅ | `Found 0 errors` → `Nest application successfully started` → `MES backend 已启动：http://localhost:3001` |
| 2 | `/api/v1/health` 200 且带 `X-Request-Id` | ✅ | `HTTP/1.1 200 OK` + `X-Request-Id: 53a18426-…`，body `code:0` |
| 3 | `/api/v1/health?unexpectedField=1` → 10001 | ✅ | `HTTP/1.1 400`，`{"code":10001,"message":"参数错误","data":{"errors":[{"field":"unexpectedField","reason":"未知字段，请求被拒绝"}]}}` |
| 4a | `page=abc` → 10001 | ✅ | `400`，`errors:[{"field":"page","reason":"page 必须为非负整数"}]` |
| 4b | `pageSize[]=10` → 10001 | ✅ | `400`，`errors:[{"field":"pageSize[]","reason":"未知字段，请求被拒绝"}]` |
| 4c | `page=9007199254740993` → 10001 | ✅ | `400`，`errors:[{"field":"page","reason":"数值超出安全整数范围"}]` |
| 5 | 临时抛错接口 500 为安全文案 | ✅ | `500`，`{"code":50001,"message":"服务器内部错误","data":null}`；body 中**不含** `INTERNAL_MARKER_SHOULD_NOT_LEAK` / `secret`（e2e 已断言） |
| 6 | `synchronize` 写死 `false` | ✅ | grep：`typeorm.config.ts:56 synchronize: false`、`:57 migrationsRun: false`；`DB_SYNCHRONIZE` 仅出现在启动闸门（L24–L28），**不存在覆盖逻辑** |
| 7 | 回归：`/health` 原有行为不变 | ✅ | `200`，`{"code":0,"message":"成功","data":{…"database":{"status":"up","version":"8.4.9"}}}`，字段与首轮完全一致 |

**额外验证（超出要求的 7 项）：**

| 项 | 结果 | 证据 |
|---|---|---|
| 真实数组形态 `?pageSize=10&pageSize=20` | ✅ 10001 | `errors:[{"field":"pageSize","reason":"pageSize 必须为非负整数"},{"field":"pageSize","reason":"pageSize 必须为单个数字字符串"}]` |
| `pageSize=0` / `pageSize=101` | ✅ 10001 | `reason:"pageSize 必须在 1~100 之间"` |
| `page=-1` / `page=1e3` | ✅ 10001 | `reason:"page 必须为非负整数"` |
| 合法分页 `?page=2&pageSize=50` | ✅ 200 | `{"code":0,"message":"成功","data":{"page":2,"pageSize":50,"skip":50,"take":50}}` |
| 不带分页参数 | ✅ 200 | `{"page":1,"pageSize":20,"skip":0,"take":20}` |
| 404 响应带 `X-Request-Id` | ✅ | `HTTP/1.1 404` + `X-Request-Id: 88c1902b-…` |
| **启动闸门** `DB_SYNCHRONIZE=true` | ✅ 退出码 **1** | `ERROR [ExceptionHandler] Error: [FATAL] 检测到 DB_SYNCHRONIZE 被设为启用值。数据库表结构已由 db/schema.sql 冻结，禁止 TypeORM 自动同步（synchronize 已在代码中写死为 false）。请从 .env / 环境变量中移除 DB_SYNCHRONIZE 后重启。` |
| 构建 / 单测 / e2e | ✅ 全绿 | `npm run build` exit 0；`npm test` **25 例**通过；`npm run test:e2e` **8 例**通过（第三轮后单测升至 **30 例**，见 §7.3.1） |
| 临时路由已清理 | ✅ | 删除 `src/modules/selftest/` 后路由表仅剩 `/health`、`/api/v1/health`；`/__selftest/pages` 返回 404/30001 |

> **关于第 4、5 项的实测方式**：本会话**不得新增业务接口**，因此借助一个**临时自测控制器**
> （`src/modules/selftest/`，含 `/__selftest/pages` 分页探针与 `/__selftest/boom` 抛错探针）完成实测；
> 跑完即**整体删除该目录**，并复测确认路由消失（见上表末行）。

#### 7.3.1 第三轮补充验证（`skip` 越界，HTTP 层实测）

同样借助**临时** `/__selftest/pages` 探针实测（跑完已删除，路由表复测仅剩 `/health`、`/api/v1/health`）：

| 请求 | 结果 | 实测 body |
|---|---|---|
| `?page=9007199254740991&pageSize=100` | ✅ **400 / 10001** | `{"code":10001,"message":"参数错误","data":{"errors":[{"field":"page","reason":"page 与 pageSize 组合计算出的偏移量超出安全整数范围"}]}}` |
| `?page=9007199254740991`（默认 `pageSize=20`） | ✅ **400 / 10001** | 同上 |
| `?page=9007199254740991&pageSize=2` | ✅ **400 / 10001** | 同上 |
| `?page=9007199254740991&pageSize=1` | ✅ **200**（合法边界） | `{"code":0,"message":"成功","data":{"page":9007199254740991,"pageSize":1,"skip":9007199254740990,"take":1}}` |
| `?page=90071992547410&pageSize=100` | ✅ **200**（最大合法 `skip`） | `{"code":0,"message":"成功","data":{"page":90071992547410,"pageSize":100,"skip":9007199254740900,"take":100}}` |
| `?page=90071992547411&pageSize=100` | ✅ **400 / 10001**（边界 +1） | 同上 10001 |
| `?page=2&pageSize=50`（回归） | ✅ **200** | `{"page":2,"pageSize":50,"skip":50,"take":50}` |
| 不带参数（回归） | ✅ **200** | `{"page":1,"pageSize":20,"skip":0,"take":20}` |

单元测试：`npm test` → **3 文件 / 30 例全通过**（其中 `pagination.spec.ts` **23 例**，含本轮新增的 6 例 `skip` 边界回归）；
`npm run test:e2e` → **8 例全通过**；`npm run build` → exit 0。

### 7.4 本次新增 / 变更文件清单

- **新增**：`src/common/middleware/request-id.middleware.ts`、`src/common/pipes/create-validation.pipe.ts`、
  `src/common/dto/pagination-query.dto.ts`、`src/modules/health/health-query.dto.ts`
- **修改**：`src/bootstrap.ts`、`src/config/typeorm.config.ts`、`src/common/dto/pagination.ts`（第二、三轮各改一次）、
  `src/common/filters/all-exceptions.filter.ts`、`src/modules/health/health.controller.ts`、
  `src/common/dto/pagination.spec.ts`（第二、三轮各扩充一次）、`test/app.e2e-spec.ts`、`.env`、`.env.example`
- **新增依赖**：`class-validator@0.15.1`、`class-transformer@0.5.1`
- **删除**：临时目录 `src/modules/selftest/`（两轮验收后均已清理）
- **未改动**：`db/schema.sql`、`db/seed.sql`、`data/*.xlsx`、`docs/api-contract.md`

### 7.5 遗留 / 提示

- [ ] 5xx 的 `data` 保留规则见 §5.2 新增条目：后续模块如需在 5xx 回传诊断信息，
  必须走 `BusinessException` 并自行确认不含敏感内容。
- [ ] `ValidationPipe` 已全局启用，但**当前只有健康检查一个接口**；S5 起每个接口都必须声明
  query / body DTO，否则该接口的参数不会被校验。
- [ ] 仍未做：CORS、JWT / RBAC / 审计（属 S10）、`dateStrings`（属业务 DTO 层）。

### 7.6 闭环说明（2026-10-10）

审查报告提出的 P1×1 + P2×4 共 **5 项**已在第二轮全部修复；复审在此基础上补充指出
**分页 `skip` 计算结果未做安全整数校验**（属同一 P2 条目的延伸），已于第三轮修复并补齐边界回归测试。

**至此审查与复审提出的全部问题均已修复，且每一项都有实测证据（§7.3 / §7.3.1）。**
本文档 §1 中关于"首轮表述不准确"的说明、§4.1 的测试数对照、§5.2 的条目状态
均已同步更新，**文档描述与代码实现现已一致，可以进入复审**。
