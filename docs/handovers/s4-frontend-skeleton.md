# 交接文档 — S4 Vue3 前端骨架 — 2026-10-10

> **状态：已完成 → 审查第一轮（P2×2 + P3×1）已修复并复验（2026-10-10），待复审。**
> 落点：`mes-upgrade-starter/frontend/`，端口 **3000**（docs/开发启动指令.md 阶段二）。
> 技术栈：Vue 3.5.43 + TypeScript 6.0.3 + Vite 8.3.4 + Vue Router 4.6.4 + Pinia 3.0.4 + Element Plus 2.14.7。
> `typecheck` / `build` / `test`（**9 文件 / 134 例**）全绿；3000 端口实测可访问；浏览器实测覆盖桌面 1440×900 与窄屏 390×844。
> 未改动 `backend/**`、`ai-service/**`、`ai-demo/**`、`db/**`、`data/**`、企业原始资料、`docs/api-contract.md`（证据见 §4.6）。
> 本轮**不实现**业务图表、扫码、PWA、AI 对话与任何 CRUD。
> 审查修复记录见 **§9**（含逐项复现与回归证据）。

---

## 1. 本会话做了什么

### 1.1 实际读到的上游状态

| 项 | 实际状态 |
|---|---|
| NestJS（`backend/`，3001） | 骨架 + `GET /health`、`GET /api/v1/health` 可用；统一包体 `{code,message,data}`、契约 §3 全量错误码、分页 `{list,total,page,pageSize}`、BIGINT 转字符串、拒绝未知字段、`X-Request-Id` 均已落地 |
| NestJS 鉴权 | **未实现**（无 JWT / RBAC / 审计，属 B9 → S10）。所有业务接口不存在 |
| NestJS CORS | **未开放**，契约 §2.1 要求前端走同源代理 |
| FastAPI（`ai-service/`，8000） | v0.8.0，5 个内部接口 + 健康检查已通过审查；**只绑定 127.0.0.1**，浏览器不得直连 |
| 前端 | `frontend/` 已存在，但仅为 `npm create vite -- --template vue-ts` 的**默认脚手架**（HelloWorld 样板、无 node_modules）；按指令「保留已有工作、不覆盖重建」，仅在其上扩展 |

### 1.2 本轮完成内容

1. **工程基础**：扩展脚手架为可启动 / 可类型检查 / 可构建的工程；`@` 别名、`dev`/`typecheck`/`build`/`test` 脚本、Element Plus 中文语言包、按需引入的图标映射。
2. **单一配置源**：`config/permissions.ts`（契约 §5.2 的 41 条细粒度权限矩阵）+ `config/modules.ts`（17 个模块）。路由、菜单、面包屑、页面标题、权限元数据**全部由这一份配置派生**。
3. **布局**：`layouts/AppLayout.vue` —— 左侧分组菜单（7 组，可折叠）、顶部项目名 + 当前页标题 + 面包屑 + 当前用户区、主内容区；窄屏侧栏整体收起 / 浮层展开；`.table-scroll` 预留横向滚动。
4. **路由与占位页**：17 条命名 + 懒加载路由，403 / 404 / 未知路径兜底；通用占位页明确写「本模块尚未实现」，只展示模块编号、计划接口与允许身份，**无假列表、假统计、假成功提示、可点击业务按钮**。
5. **登录与认证接入准备**：登录页（字段严格对应 `POST /api/v1/sessions`）、认证 store（令牌仅内存）、`GET /api/v1/users/me` 预留、路由守卫；**骨架预览**与正式认证完全分离。
6. **HTTP 请求基础设施**：同源代理 `/api → 127.0.0.1:3001`；统一包体处理（HTTP 200 但 `code != 0` 按业务失败）；超时 + 取消；401/403/404/参数错误/依赖不可用/超时分别处理；保留 `X-Request-Id`；写请求不自动重试。
7. **真实状态与演示标识**：`LoadingState` / `EmptyState` / `ErrorState` / `ForbiddenState` / `NotImplementedState`；`DataSourceTag`（demo / enterprise-master / enterprise-documents 分别标注）；`AiModeTag`（`mode`/`degraded` 预留，本轮不接入 AI）。

### 1.3 目录方案

```
frontend/
├── .env.development / .env.example      # 非敏感配置模板（VITE_ENABLE_SKELETON_PREVIEW）
├── vite.config.ts                        # @ 别名、3000 端口、/api → 127.0.0.1:3001
├── vitest.config.ts                      # 纯逻辑单测（node 环境，不引入 jsdom）
└── src/
    ├── config/       # app / modules（单一配置源）/ permissions（§5.2 矩阵）/ skeleton-preview
    ├── layouts/      # AppLayout.vue + layout.ts（尺寸规则，纯函数）
    ├── router/       # routes / index / guard / access（决策纯函数）/ redirect（防开放重定向）
    ├── services/     # http / api-error（纯映射）/ auth / health / notify
    ├── stores/       # auth（内存令牌）/ app（侧栏 + 骨架预览）
    ├── types/        # api / auth / health / role / ai（预留）/ router-meta
    ├── components/   # AppIcon / AuthUserArea / DataSourceTag / AiModeTag / RequestIdNotice /
    │                 # SkeletonPreviewBanner / state/*（5 个公共状态组件）
    ├── composables/  # useAsyncTask（loading 必结束 + 取消）/ useViewport（防抖）
    ├── styles/       # variables.css（设计令牌）/ index.css（重置 + 公共状态块 + .table-scroll）
    ├── utils/        # format.ts（null 不转 0 / BIGINT 保持字符串 / 百分比不乘除 100）
    └── views/        # HomeView / LoginView / ModulePlaceholderView / error/{403,404}
```

---

## 2. 文件清单

### 2.1 新增（`frontend/`，共 57 个 `src/**` 文件 + 3 个工程文件）

| 分组 | 文件 |
|---|---|
| 工程 | `.env.development`、`.env.example`、`vitest.config.ts` |
| config | `app.ts`、`modules.ts`、`modules.spec.ts`、`permissions.ts`、`permissions.spec.ts`、`skeleton-preview.ts` |
| layouts | `AppLayout.vue`、`layout.ts`、`layout.spec.ts` |
| router | `index.ts`、`routes.ts`、`guard.ts`、`access.ts`、`access.spec.ts`、`redirect.ts`、`redirect.spec.ts` |
| services | `http.ts`、`api-error.ts`、`api-error.spec.ts`、**`http.spec.ts`**、`auth.ts`、`health.ts`、`notify.ts` |
| stores | `auth.ts`、`app.ts` |
| types | `api.ts`、`auth.ts`、`health.ts`、`role.ts`、`ai.ts`、`router-meta.ts`、`env.d.ts` |
| components | `AppIcon.vue`、`AuthUserArea.vue`、`DataSourceTag.vue`、`AiModeTag.vue`、`RequestIdNotice.vue`、`SkeletonPreviewBanner.vue` |
| components/state | `LoadingState.vue`、`EmptyState.vue`、`ErrorState.vue`、`ForbiddenState.vue`、`NotImplementedState.vue` |
| composables | `useAsyncTask.ts`、**`useAsyncTask.spec.ts`**、`useViewport.ts` |
| styles | `variables.css`、`index.css` |
| utils | `format.ts`、`format.spec.ts` |
| views | `HomeView.vue`、`LoginView.vue`、`ModulePlaceholderView.vue`、`error/ForbiddenView.vue`、`error/NotFoundView.vue` |

> `package-lock.json` 为本轮 `npm install` 生成的锁文件，**保留入库**。

### 2.2 修改

| 文件 | 变更 |
|---|---|
| `package.json` | 新增依赖（vue-router / pinia / element-plus / @element-plus/icons-vue / axios）与 `typecheck`/`test` 脚本；`preview` 固定 3000 |
| `vite.config.ts` | `@` 别名、`server.port=3000`（strictPort）、`/api` → `http://127.0.0.1:3001`；**未添加任何指向 8000 的代理** |
| `tsconfig.app.json` | 增加 `paths: { "@/*": ["./src/*"] }`（TS 6 已弃用 `baseUrl`，故不写 `baseUrl`） |
| `tsconfig.node.json` | `include` 增加 `vitest.config.ts` |
| `index.html` | `lang="zh-CN"`、标题与描述改为项目名称 |
| `.gitignore` | 增加 `.env` / `.env.local` / `.env.*.local`（与项目「凭据不落盘」口径一致） |
| `src/main.ts` | 装配 pinia → router → Element Plus（zh-cn）、注册令牌提供者与 401 处理器、引入设计令牌与全局样式 |
| `src/App.vue` | 改为纯 `<router-view />` |

### 2.3 删除（脚手架样板，非「已有工作」）

`src/components/HelloWorld.vue`、`src/style.css`、`src/assets/{hero.png,vite.svg,vue.svg}`。

### 2.4 原样保留

`README.md`、`public/favicon.svg`、`public/icons.svg`、`.vscode/extensions.json`。

---

## 3. 接口清单（本轮实际调用）

本轮**只实现通用基础设施 + 健康检查调用**，不调用任何业务 API。

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/api/v1/health` | 首页服务状态（公开运维接口，经同源代理到 3001） | 上游已实现，本轮已接入 |
| POST | `/api/v1/sessions` | 登录（用户显式提交时发起，非自动调用） | **上游未实现**（B9/S10） |
| GET | `/api/v1/users/me` | 当前用户资料 | **仅预留类型与服务方法，未调用** |

---

## 4. 自测结果

环境：Node **22.22.2**（managed）/ npm **10.9.7** / Windows。安装命令 `npm install --legacy-peer-deps`（沿用 S2 交接文档 §5.1 的约定；本依赖树加不加均可，加参数后无告警）。

### 4.1 构建、类型检查与测试

| # | 命令 | 期望 | 实际 |
|---|---|---|---|
| 1 | `npm install --legacy-peer-deps` | 安装成功、保留锁文件 | ✅ `added 138 packages`，`found 0 vulnerabilities`，生成 `package-lock.json` |
| 2 | `npm run typecheck`（`vue-tsc -b`） | 0 错误 | ✅ exit 0，无输出 |
| 3 | `npm test`（`vitest run`） | 全通过 | ✅ **9 文件 / 134 例全通过**（审查修复后，原为 7 文件 / 100 例） |
| 4 | `npm run build`（`vue-tsc -b && vite build`） | 成功产出 `dist/` | ✅ `✓ 1721 modules transformed`，`built in 3.87s` |

**失败项：无。** 过程中出现并已修复的问题见 §5.1 与 §9。

**测试覆盖（9 个 spec）**——其中 2 个是审查第一轮新增，专门覆盖**实际请求拦截器**与**异步取消生命周期**（原测试只覆盖纯函数，未能拦住 §9 的两项 P2）：

| spec | 例数 | 覆盖点 |
|---|---|---|
| `services/http.spec.ts`（新增） | 14 | **真实拦截器链**（替换 axios adapter，不绕过拦截器）：不完整包体拒绝、`data:null` 合法、字段类型错误拒绝、非契约包体拒绝、业务失败保留字段明细与请求号、403 不触发重登、401 触发一次重登、无令牌时 401 不触发（防循环）、写请求不重试（POST/PATCH/DELETE/GET 各计调用次数）、令牌自动携带 |
| `composables/useAsyncTask.spec.ts`（新增） | 10 | 成功/失败/同步抛错后 loading 结束；**取消后 loading 立即结束且不写入 data/error**；底层 Promise 忽略 abort 也不卡 loading；取消后可重新发起；**并发时旧轮次不得结束新轮次的 loading、不得写入 error**；作用域销毁自动取消；reset 清空 |
| `services/api-error.spec.ts` | 30 | HTTP 200 但 `code != 0` 按业务失败；401/403/404/409/429/5xx 分类；403 不伪装成登录失效；5xx 安全文案不泄露原文；超时 / 网络 / 取消；`X-Request-Id` 读取；**包体完整性校验（`checkEnvelope`）与错误分支兜底** |
| `router/access.spec.ts` | 13 | 匿名拦截 + 返回地址记录与清洗；三角色 × 逐模块访问决策；骨架预览放行与关闭后失效 |
| `config/permissions.spec.ts` | 31 | 契约 §5.2 逐行抽样核对；17 个模块的页面可见角色；「能进页面 ≠ 能执行所有操作」 |
| `config/modules.spec.ts` | 12 | key/path 唯一、分组合法、编号覆盖 B1–B12/F1–F3；路由由配置派生（name/path/meta 与配置逐字段一致）；403/404/登录/兜底路由存在 |
| `router/redirect.spec.ts` | 6 | 开放重定向防护（`https://`、`//host`、`/\`、`/javascript:`、含空白、非字符串） |
| `utils/format.spec.ts` | 10 | null 不转 0；BIGINT 字符串不被 `Number()` 破坏（`9007199254740993` 原样保留）；DECIMAL 保持 `"2.00"`；百分比不乘除 100；计算状态与缺失项文案 |
| `layouts/layout.spec.ts` | 8 | 侧栏 220 / 64 / 0 三态；窄屏不使用图标折叠；遮罩条件；断点一致性；自动收起为边沿触发 |

### 4.2 3000 端口与同源代理

| # | 命令 | 期望 | 实际 |
|---|---|---|---|
| 1 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/` | 200 | ✅ `200` |
| 2 | `curl -i http://127.0.0.1:3000/api/v1/health`（后端未启动） | 代理到 3001 并失败 | ✅ `HTTP/1.1 502 Bad Gateway`（证明代理目标是 3001） |
| 3 | 桩后端场景：`GET /api/v1/ai/rag-answers` | 必须落到 **3001** 而非 8000 | ✅ `status 404` 且响应头 `x-stub-backend: 3001`（桩只监听 3001） |

### 4.3 浏览器实测（Playwright 1.64.0 / Chromium，headless）

> 截图与 JSON 报告位于工程外的临时目录 `%TEMP%\s4-verify\`（`shots/`、`report-nobackend.json`、`report-stub.json`），未写入仓库。

**桌面 1440×900（骨架预览态首页）**

```json
{"innerWidth":1440,"asideWidth":220,"headerTitle":"首页","projectName":"精创电子 MES",
 "mainTitle":"首页","breadcrumbs":["首页"],
 "menuGroups":["概览","生产执行","经营与质量分析","AI 能力","物料与追溯","设备","系统管理"],
 "menuItemCount":17,"bannerVisible":true,
 "userArea":"骨架预览，未登录 退出预览","bodyOverflowX":false}
```

**路由与错误页**

| 用例 | 结果 |
|---|---|
| 匿名 `/` | ✅ → `/login?redirect=/` |
| 匿名 `/orders` | ✅ → `/login?redirect=/orders` |
| `/403` | ✅ 标题「无访问权限 · 精创电子 MES」，含 403 文案与返回入口 |
| `/404` | ✅ 标题「页面不存在 · 精创电子 MES」 |
| 未知路径 `/no-such-route` | ✅ → `/404` |
| `/404?from=https://evil.example.com/x` | ✅ 页面**不显示**外部地址（已清洗） |
| 开发环境 `/orders?preview=1`、`/users?preview=true` | ✅ 仍跳登录页 —— **查询参数无法绕过预览** |

**侧栏与窄屏**

| 用例 | 结果 |
|---|---|
| 侧栏折叠 | ✅ `220px → 64px`（`app-aside is-collapsed`），再次点击恢复 `220px` |
| 窄屏 390×844 首页 | ✅ 侧栏 `1px`（含边框的隐藏态）、无横向溢出 |
| 窄屏点击展开 | ✅ `220px`、`position: fixed`、出现遮罩 |
| 窄屏菜单导航到「工序报工」 | ✅ 侧栏自动收起、无遮罩、`/reports` 渲染占位页、无横向溢出 |

**健康检查**

| 场景 | 结果 |
|---|---|
| 后端未启动 | ✅ 显示「后端服务不可达」+ 重试按钮，**不显示「正常」** |
| 桩后端（响应形状照抄 S2 交接文档 §3） | ✅ 显示 正常 / mes-backend / 0.0.1 / 已连接（MySQL 8.4.9） |

**登录与存储**

| 用例 | 结果 |
|---|---|
| 后端未启动时提交登录 | ✅ 停留 `/login`，提示「依赖服务不可用，请稍后重试。」，密码框已清空，`localStorage`/`sessionStorage` 均为空 |
| 桩后端返回 `404 / 30001` | ✅ 提示「资源不存在（请求号：stub-request-id-0001）」—— `X-Request-Id` 已保留并可复制 |

**请求与运行时错误**

```json
{"apiRequests":[
  {"method":"GET","url":"/api/v1/health","status":200},
  {"method":"GET","url":"/api/v1/health","status":200},
  {"method":"POST","url":"/api/v1/sessions","status":404},
  {"method":"GET","url":"/api/v1/health","status":200}],
 "pageErrors":[]}
```

- 全部请求均为**同源**（`127.0.0.1:3000/api/...`），无一条指向 8000，无一条直连数据库。
- `pageErrors: []`（无未捕获 JS 异常）；`bb-browser errors` 复核为「没有 JS 错误」。
- 控制台仅有 4 条 `502 Bad Gateway`（后端未启动时健康检查/登录请求的预期失败）与 2 条 Vite HMR 的 `[DEBUG]` 消息，**无业务代码残留的 `console.log`**。

### 4.4 生产构建：骨架预览不可用

以 `VITE_ENABLE_SKELETON_PREVIEW=true` **强制**执行 `npm run build` 后，用 `vite preview` 实测：

| 用例 | 结果 |
|---|---|
| `/login` | ✅ 无「进入骨架预览」按钮，DOM 中不存在该文案，`bodyHasPreviewWord:false` |
| `/login?preview=1` | ✅ 同上，未被绕过 |
| `/login?preview=true&skeleton=1` | ✅ 同上，未被绕过 |
| 匿名 `/orders` | ✅ 仍跳 `/login?redirect=/orders` |

产物侧证据：`SKELETON_PREVIEW_AVAILABLE` 被静态求值为 `false`（`skeletonPreviewAvailable` 编译为 `ref(!1)`）；`VITE_ENABLE_SKELETON_PREVIEW` 字符串在产物中**仅出现在说明文案里**。

#### 4.4.1 开发环境默认关闭（审查修复 · 第一轮）

`.env.development` 已改为 `VITE_ENABLE_SKELETON_PREVIEW=false`。两种状态实测：

| 启动方式 | `/login` 结果 |
|---|---|
| `npm run dev`（默认） | ✅ **无预览入口**：`hasPreviewButton:false`、`htmlHasPreviewEntry:false` |
| `npm run dev` + `?preview=1` | ✅ 仍无入口 |
| `VITE_ENABLE_SKELETON_PREVIEW=true npm run dev`（显式开启，仅供布局验收） | ✅ 出现入口，且预览流程正常：横幅可见、侧栏 220px、健康检查按真实结果展示、**连续两次「重新检查」后 loading 不卡住** |

### 4.5 凭据扫描

| 扫描对象 | 关键字 | 结果 |
|---|---|---|
| `dist/**` | `AI_SERVICE_TOKEN` / `AI_API_KEY` / `DB_PASSWORD` / `JWT_SECRET` / `DB_USER` / `DB_HOST` / `password_hash` | ✅ **0 命中** |
| `src/**`、`.env.development`、`.env.example` | 同上 | ✅ 命中项**全部是「禁止写入秘密」的注释与说明文案**，无任何值 |
| `src/**` | `localStorage` / `sessionStorage` | ✅ 仅出现在「不使用它们」的注释中，无实际读写 |

### 4.6 修改范围合规

工作区**不是 git 仓库**，无法给出 diff；改用 mtime 佐证（本会话开始约 13:24）：

| 上游文件 | mtime | 结论 |
|---|---|---|
| `ai-service/main.py` | 13:12:36 | 早于本会话 |
| `ai-service/knowledge.json` | 12:17:18 | 早于本会话 |
| `docs/handovers/s3-ai-service.md` | 13:15:04 | 早于本会话 |
| `docs/handovers/s2-backend-skeleton.md` | 12:21:00 | 早于本会话 |
| `docs/api-contract.md` | 01:10:17 | 早于本会话 |
| `backend/src/main.ts` / `backend/package.json` | 01:32 / 01:58 | 早于本会话 |
| `db/schema.sql` | 01:10:27 | 早于本会话 |

本轮写入范围：`frontend/**` 与本文档。

---

## 5. 固定验收清单

### A. 工程

| 项 | 结论 | 证据 |
|---|---|---|
| 依赖安装成功 | **通过** | §4.1 #1；锁文件已保留 |
| typecheck 成功 | **通过** | §4.1 #2 |
| build 成功 | **通过** | §4.1 #4 |
| 3000 端口启动并可访问 | **通过** | §4.2 #1 |
| 无明显浏览器运行错误 | **通过** | §4.3：`pageErrors: []`、`bb-browser errors` 无错误；控制台无业务 `console.log` |

### B. 路由和布局

| 项 | 结论 | 证据 |
|---|---|---|
| 首页、登录、403、404 可正确渲染 | **通过** | §4.3 截图 + 文本断言 |
| 菜单、面包屑、页面标题一致 | **通过** | 三者同源于 `config/modules.ts`；`modules.spec.ts` 断言 `route.meta.title === module.title`；实测 `/orders` 页头、面包屑末项、`document.title` 均为「生产订单」 |
| 未知路径进入 404，受保护路由不能匿名执行业务 | **通过** | §4.3；`access.spec.ts` 逐模块断言匿名必被拦截 |
| 骨架预览显著标注未登录 | **通过** | 顶部横幅「骨架预览，未登录」+ 用户区标签 + 占位页提示，三处标注（截图 `desktop-04-home-preview.png`） |
| 生产环境不能启用骨架预览 | **通过** | §4.4；开发环境默认关闭见 §4.4.1 |
| 桌面与窄屏布局均可用 | **通过** | §4.3：1440×900 侧栏 220/64；390×844 侧栏隐藏→浮层 220 + 遮罩；两者均无横向溢出 |

### C. 请求层

| 项 | 结论 | 证据 |
|---|---|---|
| `/api` 同源代理指向 NestJS 3001 | **通过** | §4.2 #2、#3 |
| 浏览器不访问 FastAPI 内部接口 | **通过** | §4.3 请求列表：全部同源；`vite.config.ts` 无 8000 目标 |
| 健康检查成功与服务不可达状态都真实展示 | **部分通过（见说明）** | 「不可达」为**真实**后端缺席场景 ✅；「成功」用**明确标注的桩**验证渲染分支 ✅，但**真实 NestJS 端到端未验证**（原因见 §6.2） |
| 业务错误、401、403、超时能正确处理，loading 不挂住 | **通过** | ①**真实拦截器**：`http.spec.ts` 14 例（替换 axios adapter 走完整拦截器链）覆盖不完整包体、业务失败、401/403、写请求不重试；②**异步生命周期**：`useAsyncTask.spec.ts` 10 例覆盖成功/失败/同步抛错/**取消**/并发/卸载，断言 loading 必结束；③错误分类由 `api-error.spec.ts` 30 例覆盖；④401 仅在「此前持有令牌」时触发，避免跳转循环与重复弹窗 |
| 写请求不自动重试 | **通过** | `grep -rn "retry" src` 仅命中 `ErrorState` 的**用户手动**重试按钮，无任何自动重试逻辑 |
| `X-Request-Id` 可保留用于排查 | **通过** | §4.3 登录用例：提示中含「请求号：stub-request-id-0001」；`RequestIdNotice` 提供复制按钮 |

### D. 权限接入准备

| 项 | 结论 | 证据 |
|---|---|---|
| 路由权限配置与契约 §5.2 核对一致 | **通过** | `permissions.spec.ts` 31 例逐行抽样 + 17 模块可见角色全量断言 |
| 用不含真实令牌的测试身份验证三角色配置与守卫逻辑 | **通过** | `access.spec.ts` 以 `{isAuthenticated, role}` 构造身份，覆盖 admin/manager/operator × 17 模块；测试数据不进入运行时（不在任何 store 初始化路径中） |
| 登录接口尚未实现的限制明确记录 | **通过** | 登录页显著提示 + 本文档 §6.2 |
| 不把配置测试写成「真实 JWT/RBAC 联调已通过」 | **通过** | 全文未作此表述；§6.2 明确「上游未实现」 |

### E. 安全与诚信

| 项 | 结论 | 证据 |
|---|---|---|
| 源码、配置及构建产物无密码、服务令牌、AI Key | **通过** | §4.5 |
| 无假业务数据、假登录或假成功提示 | **通过** | 占位页断言 `bodyHasFakeTable:false`、`bodyHasBusinessButton:false`；登录失败实测仍停留登录页、无登录态 |
| null 不转成 0，BIGINT 不转 Number | **通过** | `format.spec.ts` 10 例；`formatId('9007199254740993')` 原样返回 |
| 演示数据标识组件与未实现状态组件可复用 | **通过** | `DataSourceTag`（三类来源分别标注，主数据**不**标成演示数据）+ `NotImplementedState` |
| 上游受保护文件未修改 | **通过** | §4.6 |

### 无法验证项

| 项 | 原因 |
|---|---|
| 真实 NestJS 端到端（含健康检查成功分支的真实性） | 本机后端启动需 `DB_PASSWORD`，该口令按项目口径**不落盘**、只从进程环境变量注入，本会话未获得。改用**明确标注的桩**验证前端渲染分支（§4.3 / §6.2） |
| 三角色真实登录后的菜单与 403 表现 | 依赖 `POST /api/v1/sessions`（上游未实现）。当前仅验证了配置与守卫逻辑 |
| 各业务模块的表格横向滚动实际效果 | 本轮无业务表格；仅提供 `.table-scroll` 工具类，待 S5 起在真实表格上验证 |

---

## 6. 已知问题

### 6.1 S4 实现缺陷

**无遗留缺陷。** 累计发现并修复 3 项，全部有回归测试与实测证据：

1. **（自查发现）瞬时 resize 会误折叠侧栏。** 初版 `useViewport` 对 `resize` 直接响应，且 `watch` 无 `immediate`/边沿判断。实测发现一次 Playwright 全页截图（会触发瞬时尺寸变化）即可把桌面侧栏**永久**折叠成 64px 图标态。
   **修复**：`resize` 增加 150ms 去抖（`RESIZE_DEBOUNCE_MS`）；自动收起改为**边沿触发**（仅在「宽 → 窄」时动作），并抽出纯函数 `shouldAutoCollapseOnEnterNarrow` 加以单测。修复后复测：折叠 `220→64`、恢复 `→220` 均符合预期。
2. **（审查第一轮 P2）取消请求后 loading 卡住** —— 见 §9.1，已修复并新增 10 例生命周期回归测试。
3. **（审查第一轮 P2）不完整响应被当作成功** —— 见 §9.2，已修复并新增 14 例真实拦截器回归测试。
4. **（审查第一轮 P3）开发预览入口默认开放** —— 见 §9.3，`.env.development` 已改为 `false`。

**已知工程事项（非缺陷，供审查判断）：**

- 主 chunk `index-*.js` 约 903 kB（gzip 288 kB），来源是 Element Plus **全量引入**（`app.use(ElementPlus)`）。构建器给出 chunk 体积告警，不影响功能。如需瘦身，可后续引入按需导入插件；本轮按「避免无关依赖」原则未额外引入 `unplugin-*`。
- `vite preview` 未配置 `/api` 代理（仅 `server.proxy` 有）。生产部署需由反向代理把 `/api` 转到 3001；这与契约 §2.1「同源代理」一致，非缺陷。
- 产物中仍保留骨架预览相关字符串（未被摇树移除），但运行时开关恒为 `false`，行为已实测安全（§4.4）。若审查要求「产物层面也不含预览入口」，需把 `v-if` 改为编译期常量分支。

### 6.2 上游接口尚未实现（不属本轮缺陷）

- `POST /api/v1/sessions`（登录）、`GET /api/v1/users/me`：属 B9 → **S10**。因此正式登录不可用，界面明确显示「认证模块待接入」。
- 全部业务接口（订单 / 工单 / 报工 / 检验 / 看板 / 预警 / 问数 / 日报 / RAG / 用户 / 审计 / SPC / MRP）：未实现，各占位页已列出计划接口路径。
- JWT / RBAC / 审计：未实现；**前端菜单隐藏与路由守卫不能替代后端鉴权**。
- NestJS 未开放 CORS：前端必须走同源代理（已按此实现）。

### 6.3 等待业务决策（Q4，不自行宣称已实现）

- JWT 有效期、签名算法、刷新与退出即时失效策略 —— **未实现，也未预设刷新方案**。
- 首登强制改密：`sys_user` 无改密状态列，Q4 解决前不承诺该流程。
- 密码策略、改密后令牌失效范围。
- 另：契约 §10.2 的 Q2 / Q3（剩余）/ Q6 / Q7 / Q8 / Q9 / Q10 仍待确认，前端相关部分（状态机按钮、预警去重、实时通道、幂等补发）本轮**均未实现**，也未预留可执行的占位操作。

---

## 7. 给 S5 的接入说明

### 7.1 页面如何注册路由与权限

**只改 `src/config/modules.ts`，不要新建路由文件。**

```ts
{
  key: 'orders',                       // 唯一 key，同时是路由 name
  path: '/orders',                     // 绝对路径
  title: '生产订单',                    // 菜单 / 面包屑 / 页面标题 / document.title 共用
  group: 'production',                 // 菜单分组
  icon: 'order',                       // components/AppIcon.vue 的映射名
  code: 'B1',
  summary: '……',
  readPermission: 'orders:read',       // ← 页面可见角色由它推导（契约 §5.2）
  plannedApis: ['GET /api/v1/orders'], // 占位页展示；实现后可保留
  implemented: false,                  // 实现后改 true
  component: () => import('@/views/orders/OrdersView.vue'),  // ← 新增这一行即可接入真实页面
}
```

- 路由、菜单、面包屑、页面标题、`meta.roles` **全部自动跟随**，无需另改 `routes.ts`。
- 细粒度权限：在 `config/permissions.ts` 增加 `xxx:write` 一类键并标注允许角色；组件内用 `authStore.can('orders:write')` 控制**按钮显隐**。请勿用「能进页面」代替「能执行操作」。
- 若契约 §5.2 有变更，先改 `permissions.ts` 的矩阵，再改模块的 `readPermission`；`permissions.spec.ts` 会失败以提示同步。

### 7.2 如何调用请求客户端

```ts
import { httpGet, httpPost, httpPatch, httpDelete } from '@/services/http'
import type { PageResult } from '@/types/api'

// 列表：分页参数直接传，返回 { list, total, page, pageSize }
const page = await httpGet<PageResult<Order>>('/orders', { page: 1, pageSize: 20, status })

// 创建：201 与 200 都由同一路径处理，包体已拆好
const order = await httpPost<Order>('/orders', { code, productCode, qty, dueDate })

// 取消：把 AbortSignal 传进第三个参数（配合 useAsyncTask）
await httpGet<Order>('/orders/101', undefined, { signal })
```

- **不要**自己写 `axios` 实例；统一客户端已处理包体拆解、`code != 0` 视为失败、超时（15s）、401 清理登录态。
- 错误一律是 `ApiError`（`kind` / `code` / `httpStatus` / `requestId` / `fieldErrors`）。用 `showApiError(error)` 提示（自带去重），或交给 `ErrorState` 组件渲染。
- **不要给写请求加重试**；断网/超时后由用户确认再提交（契约 §2.4）。
- 组件内推荐用 `useAsyncTask`，它保证 loading 在成功/失败/超时/取消后都会结束，并在卸载时取消在途请求：

```ts
const task = useAsyncTask<PageResult<Order>>()
onMounted(() => task.run((signal) => httpGet('/orders', { page: 1 }, { signal })))
// 模板：<LoadingState v-if="task.loading.value" />
//       <ErrorState v-else-if="task.error.value" :error="task.error.value" retryable @retry="reload" />
//       <EmptyState v-else-if="!task.data.value?.list.length" />
```

### 7.3 如何展示分页、错误、数据来源与空值

| 需求 | 用法 |
|---|---|
| 分页 | 类型 `PageResult<T> = { list, total, page, pageSize }`；空列表用 `EmptyState`，不要用 `total` 反推数据 |
| 错误 | `<ErrorState :error="e" />`（自动按 401/403/404/超时/依赖不可用给出对应标题与文案，并展示可复制的请求号） |
| 响应格式异常 | 包体不完整（缺 `code` / `message` / `data`）或字段类型错误时，客户端抛 `kind:'malformed'`，**不会**当作成功，也不会返回 `undefined`；文案为「响应格式不符合接口契约（原因）」 |
| 数据来源 | `<DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" />`。`demo → 演示数据`（用响应里的 `dataLabel`）、`enterprise-master → 企业主数据`、`enterprise-documents → 企业文档`；**主数据不得标成演示数据** |
| 空值 | `formatNullableText / formatCount / formatPercent / formatDecimal`：`null` 一律显示「暂无数据」，**不得变成 0** |
| 计算受限 | `formatCalculationStatus('insufficient_data')` → 「缺少计算条件」；配 `formatMissingInputs(缺失项)` 展示 OEE 等缺失输入（契约 §6.7） |
| BIGINT / DECIMAL | 类型层用 `Id = string` / `DecimalString`；**不要 `Number()`**，展示直接用 `formatId` / `formatDecimal` |
| AI 状态（S8/S9 用） | `AiModeTag`（`mode` + `degraded`）、`types/ai.ts` 的 `AnswerStatus` 文案表 |
| 表格横向滚动 | 给表格容器加 `class="table-scroll"` |
| 未实现模块 | `<NotImplementedState ... />`（禁止放假数据、假统计、假成功、可点击业务按钮） |

### 7.4 仍需后续认证模块接入的能力

以下能力**本轮未实现，S5 起也不得自行宣称可用**：

1. 正式登录（`POST /api/v1/sessions`）与 `GET /api/v1/users/me` 的实际调用与登录态建立。
2. JWT 的携带已就绪（`setAccessTokenProvider` 自动加 `Authorization: Bearer`），但**令牌来源、有效期、刷新、退出即时失效**均待 Q4 决策。
3. 真实的角色鉴权：当前 `meta.roles` 只做界面引导；**后端鉴权必须由 NestJS 实现**。
4. 首登强制改密流程。
5. 骨架预览仅用于验收布局：进入预览**不建立登录态、不授予业务权限、不调用业务接口**；**默认关闭**（`.env.development` 为 `false`），需要验收时用 `VITE_ENABLE_SKELETON_PREVIEW=true npm run dev` 显式开启一次即可。

---

## 8. 复核要点（供审查）

1. `config/permissions.ts` 的 41 条矩阵是否与契约 §5.2 逐行一致。
2. `config/modules.ts` 的 17 个模块命名、编号、分组是否与需求 §三/§四 一致。
3. 骨架预览的隔离是否彻底：不建立认证态、不授予权限、不调用业务接口、**开发默认关闭**（§4.4.1）、生产不可用、查询参数不可绕过。
4. `frontend/**` 之外的目录是否确实未被写入（§4.6 提供 mtime 证据）。
5. §6.1 的三条「已知工程事项」是否接受（尤其产物中保留预览文案一项）。
6. §9 的三项审查修复是否复验通过（复现证据、修复落点、回归测试）。

---

## 9. 审查修复记录（第一轮）— 2026-10-10

> 承接 S4 审查报告（P2×2 + P3×1）。**只修问题，不加功能，不改契约。**
> 报告同时指出「100 项测试通过仍遗漏」，原因是原测试只覆盖纯函数，未覆盖**实际请求拦截器**与**异步取消生命周期**——本轮据此补了两组针对性回归测试。

### 9.1 P2 · 取消请求后 loading 卡住 → 已修复

**复现**（新增测试先行，修复前失败）：

```
× cancel() 后 loading 立即结束，且不写入 data / error
× 底层 Promise 不响应 abort 时，cancel() 也不能让 loading 卡住
```

**根因**：`useAsyncTask.ts` 的 `cancel()` 把 `controller` 置为 `null`，而 `finally` 用
`if (controller === current)` 判断是否结束 loading —— 该判断在取消后**恒为 false**，`loading` 永久为 `true`。

**修复**（`src/composables/useAsyncTask.ts`）：引入 `activeRun` 对象作为「本轮身份」，不再用 controller 本身做身份判断。

- `endRun(run)`：仅当 `activeRun === run` 时才清空并结束 loading；
- `cancel()`：abort 之后**立即** `endRun(current)` —— 即使底层 Promise 忽略 signal（永不 settle）也不会卡住界面；
- `isCurrentRun(run)`：已取消 / 已被新一轮取代的轮次**不得**写入 `data` 或 `error`；
- `reset()` / `onScopeDispose()`：取消在途请求并结束 loading。

**回归测试**（`src/composables/useAsyncTask.spec.ts`，10 例）：成功 / 失败 / 同步抛错 / **取消（立即结束、不写 data/error）** / **忽略 abort 的任务** / 取消后重发 / **并发（旧轮次不得结束新轮次的 loading、不得写 error）** / 作用域销毁 / reset。

**浏览器复验**：显式开启预览后，在首页**连续两次**点击「重新检查」（触发 `run` 取消上一轮）→ `loadingStuck:false`，且重试按钮正常显示。

### 9.2 P2 · 不完整响应被当作成功 → 已修复

**复现**（修复前）：

```
× 缺 message / data 的包体一律拒绝，不返回 undefined
    AssertionError: promise resolved "undefined" instead of rejecting   ← {code:0}
× 字段类型错误一律拒绝
    AssertionError: promise resolved "null" instead of rejecting        ← {code:0, message:123, data:null}
```

**根因**：`http.ts` 只判断 `typeof body.code === 'number'`，随后即认定「契约包体」并按 `code === 0` 返回成功；
缺少 `message` / `data` 的响应因此被当作成功，调用方拿到 `undefined`。

**修复**：

- `src/services/api-error.ts` 新增纯函数 **`checkEnvelope(body)`**（+ `isContractEnvelope` 类型守卫、`malformedError` 构造器）：
  `code` 必须为有限数字、`message` 必须为字符串、**`data` 键必须存在**（契约规定「不需返回实体时用 `data:null`」，故允许 null 但不得缺失）。
- `src/services/http.ts` 成功拦截器：**先校验包体完整性**，不通过即抛 `kind:'malformed'`（含具体原因与请求号），不再静默当成功。
- `toApiError` 错误分支同步改用 `checkEnvelope`；**完整包体仍按业务码映射**（不回归）；
  若 HTTP 为错误状态却回 `code:0`（协议不一致）→ 归为 `malformed`；非包体（如代理返回 HTML）→ 仍按 HTTP 状态兜底。

**回归测试**（`src/services/http.spec.ts`，14 例）：通过替换 axios adapter **走真实拦截器链**（不是绕过它），覆盖
完整包体成功、`data:null` 合法、`{code:0}` 拒绝、缺 `data` 拒绝、`code` 非数字拒绝、`message` 非字符串拒绝、非对象/HTML 拒绝、
业务失败保留字段明细与请求号、403 不触发重登、401 触发一次重登、无令牌时 401 不触发（防跳转循环）、
**POST / PATCH / DELETE / GET 失败均只请求一次（不自动重试）**、令牌自动携带。
另在 `api-error.spec.ts` 增补 10 例 `checkEnvelope` / 错误分支用例（该文件 20 → 30 例）。

**浏览器复验**：桩后端返回完整包体（`200 / code 0` 与 `404 / 30001`）时，健康检查成功分支与登录失败提示均正常，`pageErrors: []`。

### 9.3 P3 · 开发预览入口默认开放 → 已修复

`.env.development` 的 `VITE_ENABLE_SKELETON_PREVIEW` 由 `true` 改为 **`false`**；
`.env.example` 与 `.env.development` 注释补充「默认关闭 + 验收时显式开启」的用法。

**复验**（见 §4.4.1）：默认 `npm run dev` 下 `/login` **不存在**预览入口（`hasPreviewButton:false`、`htmlHasPreviewEntry:false`），
`?preview=1` 亦无效；显式 `VITE_ENABLE_SKELETON_PREVIEW=true npm run dev` 时入口出现且预览流程正常；生产构建仍恒不可用（§4.4）。

### 9.4 修复后完整回归

| 项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ **9 文件 / 134 例全通过**（修复前 7 文件 / 100 例） |
| `npm run build` | ✅ `built in 3.87s` |
| 浏览器全量回归（桌面 + 窄屏 + 路由 + 健康检查 + 登录失败 + 存储） | ✅ 与修复前逐项一致（`report-fixed.json`） |
| 桩后端场景（健康成功分支 / 代理目标 3001 / 登录 404 带请求号） | ✅ 全部保持 |
| 生产构建预览不可用（强制 true 构建） | ✅ 保持 |
| 产物凭据扫描 | ✅ 4 类关键字 0 命中 |
| 端口清理 | ✅ 3000 / 3001 均无监听 |

**本轮修复的教训**：原测试集中在纯函数（格式化、权限矩阵、错误映射），而**真正的行为发生在拦截器与异步生命周期里**。
后续会话新增基础设施时，应对「拦截器 + 异步状态机」直接写回归测试，而不是只测被它们调用的纯函数。

---

**审查第一轮提出的 P2×2 + P3×1 已全部修复并复验（§9）；仍等待独立复审，不自行宣布 S4 放行。**
