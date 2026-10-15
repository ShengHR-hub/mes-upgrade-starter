# S10 交接文档 —— 物料 / SN 追溯 / 设备 / 权限与审计

> 会话：S10（B5 物料管理 · B6 SN 追溯 · B7 设备管理 · B9 用户权限与审计）
> 日期：2026-10-13
> 状态：**实现完成，提交「待独立审查」**。本文件不宣布独立审查通过、完整业务验收或上线批准。
> 基线：S0—S9 已通过代码复审，允许后续开发及获授权的隔离测试；**不等于真实数据库、完整业务验收或上线批准**。

---

## 0. 范围核对（与任务书逐项对照）

| 任务书要求 | 本轮状态 |
|---|---|
| 只实现 B5 / B6 / B7 / B9 | ✅ 未越界；未触碰 S11 的 SPC（B11）、MRP-lite（B12）、PWA、开放集成 API（B14） |
| 不借本轮补做 F1（RAG 知识问答） | ✅ 未实现；`route-registration.e2e-spec.ts` 显式断言 `POST /api/v1/rag-answers`、`GET /api/v1/knowledge-sources` 仍为 404/30001 |
| 冻结 18 张表、不执行 DDL、`synchronize=false` | ✅ `db/schema.sql` 未修改；未执行任何 DDL |
| 不清表、不重导、不修改既有业务数据 | ✅ 未执行任何数据库写操作；`password_hash` 占位串保持原样，未重写、未重导 |
| 不改契约文件 | ✅ `docs/api-contract.md`、`docs/需求规格说明书_定稿.md` 未修改 |
| Q6 未批准时保留 422/30006 拒绝 | ✅ 未启用预警写入 |
| 保留 S7 事务异常向上传播、历史半开区间 | ✅ 新模块沿用同一口径 |
| 保留 S8/S9 数字防幻觉与取消并发保护 | ✅ 未改动 ai-service 与 data-queries 模块 |
| 优先临时副本运行构建与测试 | ⚠️ 见 §6.3「测试环境说明」（本轮直接在原目录运行，未做临时副本） |

### 0.1 S9 规划与实际交付差异

- S9 交接将「真实 JWT 鉴权」列为 S10 范围，本轮已实现 `JwtIdentityResolver` 并替换 fail-closed 占位解析器。
- 本轮发现：`docs/api-contract.md` §5.3 定义 `POST /api/v1/sessions`、`GET /api/v1/users/me` 等接口，但 S5 交接 §13.3（Q4 决策表）中的路径写作 `modules/sessions/`；实际实现采用 `modules/auth/` 目录名，**接口路径与契约一致**（`/api/v1/sessions` 等），仅目录名与 S5 文档描述不同，属实现组织差异，不影响契约。
- 无其它规划/交付差异。

---

## 1. 现状差异（以实际文件为准，不采信旧交接的「已实现/未实现」表述）

| 事项 | 旧交接/既有文档表述 | 实际文件（本轮开始前） | 本轮动作 |
|---|---|---|---|
| 认证 | 「fail-closed，全部业务接口 401」 | `IDENTITY_RESOLVER` 默认 `NoAuthIdentityResolver` 恒返回 null | 新增 `JwtIdentityResolver`，在 `AuthModule` 替换 provider |
| `sys_user.password_hash` | 「占位串，不是可用哈希」 | 实体未映射该列 | 实体新增 `passwordHash`（`select:false`），不改表 |
| 物料 / BOM / 批次 | 仅契约与前端占位 | 无实体、无模块 | 新增实体 + 模块 |
| SN 追溯 | 仅契约与前端占位 | 无实体、无模块 | 新增实体 + 模块 |
| 设备状态日志 | `device` 实体已存在，无 `equipment_log` 实体 | 无 `equipment_log` 实体 | 新增实体（只读消费 + 关闭的写入入口） |
| 用户/日志接口 | 前端 `LoginView` 注明「认证模块待接入」 | 无 `users` / `audit-logs` 路由 | 新增模块并更新前端文案 |

---

## 2. 前置决策清单（Q3 / Q4 / Q7）—— 批准依据、待决项、关闭入口

> 原则：**已批准才实施**；未批准事项保持写入入口关闭，**不伪造字段、不把 `audit_log` 当会话或首登状态存储**。

### 2.1 Q3 —— 设备状态迁移与停机超时阈值

| 子项 | 批准状态 | 出处 | 本轮落地 |
|---|---|---|---|
| OEE 验收调整为「显示缺失项说明」 | **已批准** | `docs/api-contract.md` 第 3 行、第 24 行、第 357 行、§10.2 第 537 行（「Q3 的 OEE 验收已关闭」） | ✅ `GET /devices/{code}/oee-analyses` 缺输入返回 `oee:null` + `calculationStatus:"insufficient_data"` + `missingInputs`；前端展示缺失项，不把 null 显示成 0 |
| **设备允许状态迁移表** | **未批准（Q3 剩余）** | `docs/api-contract.md` §10.2 第 544 行：「仅停机超时告警及设备状态迁移待确认」 | ⛔ 未编造流转表。`POST /devices/{code}/state-transitions` 路由**注册但对任何流转返回 30006**（写入入口关闭）；前端入口保留用于如实展示拒绝原因，不伪造本地状态变更 |
| **停机超时阈值 / 自动停机告警写入** | **未批准** | 同上 | ⛔ 未编造阈值，未启用自动停机告警写入 |

**集中请求用户决策（Q3 剩余）**：

1. **设备允许流转表**：建议方案 —— 开放 `运行中↔待机`、`运行中→维修中`、`维修中→待机/停机`、`停机→待机`；禁止 `维修中→运行中` 直接跳转（须经待机）。**影响**：影响 B7 写入入口与 `equipment_log` 生成。**不批准则维持 30006 关闭**。
2. **停机超时阈值**：建议方案 —— 由用户在批准时给出具体分钟数；未给出前**不启用**任何自动告警。**影响**：影响 B10 预警规则。

### 2.2 Q4 —— 认证与会话

| 子项 | 批准状态 | 出处 | 本轮落地 |
|---|---|---|---|
| JWT 算法 `HS256` | **已批准** | s5 交接 §13.3 Q4-1；批准边界见 §13 章头 ①—④ | ✅ `TokenService` 固定 `alg: HS256`，校验时白名单 `['HS256']` |
| access token 有效期 2 小时 | **已批准** | 同上 | ✅ `ACCESS_TOKEN_TTL_SECONDS = 7200` |
| `iss="mes-backend"`、`aud="mes-web"` | **已批准** | 同上 | ✅ 固定常量，校验 `issuer`/`audience` |
| 密钥来自 `JWT_SECRET`（≥32 字节，不落盘） | **已批准** | 同上 | ✅ 只读进程环境变量；空串/不足 32 字节视为未配置 → fail-closed |
| **不做 refresh token；退出=清空内存令牌；即时失效靠每请求读库** | **已批准** | s5 §13.3 Q4-2；§13 章头 ①「退出不立即撤销令牌」 | ✅ 无 refresh 链路；`JwtIdentityResolver` 每请求读 `sys_user.enabled/role` |
| 口令哈希 **Argon2id** | **已批准** | s5 §13.4 AUTH-3；§13 章头 ② | ✅ `PasswordService` 使用 `@node-rs/argon2`（默认即 Argon2id） |
| **账号重置另行授权** | **批准边界** | s5 §13 章头 ③ | ⛔ 本服务**不提供**重置入口；不改写既有 `password_hash` |
| **首登强制改密** | **未批准** | s5 §13.3 Q4-3；契约 §10.2 第 545 行 | ⛔ 未实现；**未**用 `audit_log` 记录首登状态 |
| **密码强度策略（≥8 且含字母与数字）** | **未具体批准** | s5 §13.3 Q4-3 与 §13 章头 ④ | ⛔ 改密接口**不强制**该策略（仅做非空与新旧不同校验）；策略批准后补校验 |
| **改密后令牌失效范围** | **未批准** | 契约 §10.2 第 545 行「改密后令牌失效范围怎么定？」 | ⛔ 不宣称即时吊销；改密后旧令牌在有效期内仍可用（与 Q4-2 一致） |

**集中请求用户决策（Q4 剩余）**：

1. **密码强度策略**：建议方案 —— 长度 ≥8 且同时含字母与数字（s5 原推荐）。**影响**：改密接口校验强度（10001）。未批准则维持现状。
2. **改密后令牌失效范围**：建议方案 —— 本版维持「到期即重登」，不做即时吊销（与 Q4-2 一致）。**影响**：若要求即时吊销，需新增令牌版本/黑名单存储（涉及未批准的 Redis/会话存储，超出本版边界）。

### 2.3 Q7 —— 追溯导出

| 子项 | 批准状态 | 出处 | 本轮落地 |
|---|---|---|---|
| 本轮按现有契约实现**带限制说明的 JSON 追溯导出** | **已批准** | 契约 §6.6 第 343 行；§10.2 第 547 行：「JSON 追溯保留限制」 | ✅ `POST /sn-traces/{sn}/exports`（`format:"json"`）返回 `{fileName, content, format, coverage, limitations, dataSource, dataLabel}` |
| **PDF 追溯 / IATF 16949 合规验收** | **未承诺** | 契约 §10.2 第 547 行 | ⛔ 不实现 PDF；不宣称满足 IATF 16949 |

---

## 3. 新增与修改文件清单

### 3.1 后端 · 新增实体

- `backend/src/entities/material.entity.ts`
- `backend/src/entities/bom.entity.ts`
- `backend/src/entities/material-batch.entity.ts`
- `backend/src/entities/sn-trace.entity.ts`
- `backend/src/entities/equipment-log.entity.ts`

### 3.2 后端 · 新增/修改通用认证

- 新增 `backend/src/common/auth/token.service.ts`（+ `token.service.spec.ts`）
- 新增 `backend/src/common/auth/jwt-identity-resolver.ts`（+ `jwt-identity-resolver.spec.ts`）
- 新增 `backend/src/common/auth/permission-matrix.ts`（后端侧三角色权限清单，供 `GET /role-permissions`）
- 修改 `backend/src/common/auth/auth.module.ts`（绑定 `JwtIdentityResolver`）
- 修改 `backend/src/common/auth/auth.guard.ts`（文案由「未实现登录」改为令牌无效口径）
- **（P2 修复轮新增）** `backend/src/common/utils/product-lock.util.ts`（`lockProductRow`：锁定 `product` 行 FOR UPDATE，作为 BOM 写事务与订单确认的**共同互斥协议**；行锁覆盖事务提交点）

### 3.3 后端 · 新增模块

- B5：`backend/src/modules/materials/`（`materials.*` / `boms.*` / `dto/*`）
- B5：`backend/src/modules/material-batches/`（`material-batches.*` / `dto/*`）
- B6：`backend/src/modules/sn-traces/`（`sn-traces.*` / `dto/*`）
- B7：`backend/src/modules/devices/`（`devices.*` / `dto/*`）
- B9：`backend/src/modules/auth/`（`auth.module.ts` / `sessions.controller.ts` / `users.controller.ts` / `logs.controller.ts` / `auth.service.ts` / `users.service.ts` / `logs.service.ts` / `password.service.ts` / `dto/*`）

### 3.4 后端 · 修改

- `backend/src/app.module.ts`（注册 `AuthSessionsModule` / `MaterialsModule` / `MaterialBatchesModule` / `SnTracesModule` / `DevicesModule`）
- `backend/src/entities/sys-user.entity.ts`（新增 `passwordHash`，`select:false`）
- `backend/test/route-registration.e2e-spec.ts`（补 S10 路由断言 + 实体注册清单 + 未启用路由探针更新）
- **（P2 修复轮）** `backend/src/modules/materials/boms.service.ts`（`create`/`update`/`remove` 三条写事务以 `lockProductRow` 为**事务内第一条语句**；`update`/`remove` 的 `product_code` 定位移到事务外）
- **（P2 修复轮）** `backend/src/modules/orders/orders.service.ts`（`confirm` 在 `lockOrder` 后、读既有工单前调用同一 `lockProductRow`）

### 3.5 后端 · 新增测试

- `backend/src/modules/materials/boms.service.spec.ts`（16 例，**P2 修复轮改为「产品行锁协议」断言**）
- `backend/src/modules/orders/orders.service.spec.ts`（8 例，**P2 修复轮改为「confirm 产品行锁协议」断言**）
- `backend/src/modules/material-batches/material-batches.service.spec.ts`（10 例）
- `backend/src/modules/sn-traces/sn-traces.service.spec.ts`（11 例）
- `backend/src/modules/devices/devices.service.spec.ts`（10 例）
- `backend/src/common/auth/token.service.spec.ts`（12 例）
- `backend/src/common/auth/jwt-identity-resolver.spec.ts`（9 例）
- `backend/src/modules/auth/auth.service.spec.ts`（12 例）
- `backend/src/modules/auth/users.service.spec.ts`（10 例）
- `backend/test/s10-permissions.e2e-spec.ts`（三角色权限矩阵，mock 数据源 + 身份替身）
- **（P2 修复轮新增）** `backend/test/bom-confirm-race.db-e2e-spec.ts`（真实 MySQL 多连接并发验证，⚠️ 本轮未执行）

### 3.6 前端 · 新增

- 类型：`frontend/src/types/material.ts`、`device.ts`、`user.ts`
- 服务：`frontend/src/services/materials.ts`、`sn-traces.ts`、`devices.ts`、`users.ts`
- 工具：`frontend/src/utils/sn-export.ts`（+ `sn-export.spec.ts`）
- 页面：`frontend/src/views/materials/MaterialsView.vue`、`sn-traces/SnTracesView.vue`、`devices/DevicesView.vue`、`users/UsersView.vue`、`logs/LogsView.vue`
- 测试：`frontend/src/services/s10-services.spec.ts`（14 例）、`frontend/src/stores/auth.spec.ts`（5 例）

### 3.7 前端 · 修改

- `frontend/src/config/modules.ts`（B5/B6/B7/B9 模块 `implemented:true` + 真实组件）
- `frontend/src/views/LoginView.vue`（文案由「认证待接入」改为真实登录口径）
- `frontend/src/components/AuthUserArea.vue`（下拉项改为「刷新用户资料」并接入 `GET /users/me`）

> 说明：`frontend/src/main.ts`、`services/http.ts`、`stores/auth.ts`、`router/guard.ts` 的令牌注入 / 401 处理 / 内存令牌方案在 S4 已就绪，本轮**未改动**。

---

## 4. API ↔ 契约 ↔ 权限 对应表

> 权限列对应契约 §5.2 三角色矩阵；「实现状态」标注本轮是否可写入。

### 4.1 B5 物料管理

| 方法 路径 | 契约 | 允许角色 | 实现状态 |
|---|---|---|---|
| `GET /api/v1/materials` | §6.6 | 三角色 | ✅ 只读（企业主数据 `enterprise-master`） |
| `PATCH /api/v1/materials/{code}` | §6.6 | admin / manager | ✅ 仅安全库存 `safetyStock` |
| `GET /api/v1/products/{code}/boms` | §6.6 | 三角色 | ✅ 只读 |
| `POST /api/v1/products/{code}/boms` | §6.6 | admin / manager | ✅ 201；qty 十进制字符串、level≥1 |
| `PATCH /api/v1/boms/{id}` | §6.6 | admin / manager | ✅ 引用保护（30004） |
| `DELETE /api/v1/boms/{id}` | §6.6 | admin / manager | ✅ 引用保护（30004） |
| `GET /api/v1/material-batches` | §6.6 | 三角色 | ✅ 只读 |
| `POST /api/v1/material-batches` | §6.6 | 三角色 | ✅ 201；批次号唯一 |
| `GET /api/v1/material-batches/{id}/sn-traces` | §6.6 | 三角色 | ✅ 批次反查 |

### 4.2 B6 SN 追溯

| 方法 路径 | 契约 | 允许角色 | 实现状态 |
|---|---|---|---|
| `GET /api/v1/sn-traces` | §6.6 | 三角色 | ✅ 只读；`sn` 精确匹配 |
| `GET /api/v1/sn-traces/{sn}` | §6.6 | 三角色 | ✅ 单快照 + 工单级上下文 + coverage/limitations |
| `POST /api/v1/sn-traces` | §6.6 | 三角色 | ✅ 201；`productCode` 服务端取自工单；`operatorId` 来自认证身份 |
| `PATCH /api/v1/sn-traces/{sn}` | §6.6 | 三角色 | ✅ 仅当前快照；**不含 `produced_at`** |
| `POST /api/v1/sn-traces/{sn}/exports` | §6.6 | 三角色 | ✅ 仅 JSON（Q7）；文件名消毒 |

### 4.3 B7 设备管理

| 方法 路径 | 契约 | 允许角色 | 实现状态 |
|---|---|---|---|
| `GET /api/v1/devices` | §6.7 | 三角色 | ✅ 只读 |
| `GET /api/v1/devices/{code}` | §6.7 | 三角色 | ✅ 只读 |
| `GET /api/v1/devices/{code}/state-logs` | §6.7 | 三角色 | ✅ 只读（半开区间） |
| `GET /api/v1/devices/{code}/oee-analyses` | §6.7 | admin / manager | ✅ 缺输入返回 `insufficient_data` |
| `POST /api/v1/devices/{code}/state-transitions` | §6.7 | 三角色 | ⛔ **写入关闭**：任何流转返回 30006（Q3 未批准） |

### 4.4 B9 认证 · 用户 · 审计

| 方法 路径 | 契约 | 允许角色 | 实现状态 |
|---|---|---|---|
| `POST /api/v1/sessions` | §5.3 | 公共 | ✅ 凭据错误统一 20003 |
| `GET /api/v1/users/me` | §5.3 | 三角色 | ✅ 只读 |
| `POST /api/v1/users/me/password-changes` | §5.3 | 三角色 | ✅ 校验旧密码；**不强制**未批准的强度策略 |
| `GET /api/v1/users` | §5.3 | admin | ✅ 只读 |
| `POST /api/v1/users` | §5.3 | admin | ✅ 201；Argon2id 哈希 |
| `PATCH /api/v1/users/{id}` | §5.3 | admin | ✅ 最后 admin 保护（并发） |
| `GET /api/v1/role-permissions` | §5.3 | admin | ✅ 只读 |
| `GET /api/v1/audit-logs` | §5.3 | admin | ✅ 只读；无修改/删除 |
| `GET /api/v1/ai-query-logs` | §5.3 | admin | ✅ 只读；无修改/删除 |

### 4.5 前端页面 ↔ 后端授权

| 页面 | 路由 | 读权限 | 页面可见角色 | 说明 |
|---|---|---|---|---|
| 物料管理 | `/materials` | `materials:read` | 三角色 | 写按钮按 `boms:write` 显隐 |
| SN 追溯 | `/sn-traces` | `sn-traces:read` | 三角色 | 导出按 `sn-traces:export` |
| 设备管理 | `/devices` | `devices:read` | 三角色 | OEE 区按 `devices:oee:read` 显隐 |
| 用户与权限 | `/users` | `users:read` | admin | 写按钮按 `users:write` |
| 审计/AI 日志 | `/logs` | `audit-logs:read` | admin | 只读，无修改/删除入口 |

> **前端隐藏入口不代表后端放行**：以上页面按钮显隐仅为体验优化，越权请求仍由后端 `AuthGuard` + `RolesGuard` 拒绝（20002/30001）。

---

## 5. 实现说明（事务 · 并发 · 引用保护 · 身份 · 脱敏）

### 5.1 B5 事务与引用保护

- **BOM 唯一性**：同一 `(product_code, level, material_code)` 重复新增 → 30002；服务端先查重，数据库唯一约束兜底。
- **引用保护（30004）**：当产品存在已确认订单或工单时，BOM 行新增/修改/删除被拒。
- **⚠️ 并发正确性（S10 复审 P2 修复 · 第二轮 · 2026-10-14）**：
  - **缺陷（原始）**：初版把引用保护放在事务内「先查关联业务再写入」，但**仅锁 `bom` 行不足以消除竞态**。
    `BomsService.update/remove` 锁 `bom` 行，`OrdersService.confirm` 锁 `sale_order` 行，
    **二者没有共同加锁资源**，因此存在交错窗口：
    ① BOM 事务读到「无已确认订单」→ ② 订单确认事务提交 → ③ BOM 事务写入成功，
    最终形成「已确认订单对应的 BOM 被修改/删除」。
    ~~原交接文档称「事务内先查关联业务再执行写入，避免竞态绕过」——该表述不成立，已更正。~~
  - **第一版修复（已被复审判定不成立）**：用会话级命名锁 `GET_LOCK` / `RELEASE_LOCK`
    （锁名 `mes:bom-product:{code}`）串行化两条事务。
    **问题**：`RELEASE_LOCK` 写在事务回调的 `finally` 中，而 TypeORM 在**回调返回之后**才 `COMMIT`，
    因此命名锁只覆盖「回调内部」、**未覆盖事务提交点**：
    ① 确认事务 `RELEASE_LOCK`（尚未提交）→ ② BOM 事务取到锁、读不到未提交的确认结果 →
    ③ BOM 写入并提交 → ④ 确认事务才提交。竞态依旧。
  - **第二轮修复（本轮）**：**弃用会话级命名锁**，改为两条事务共同锁定**同一持久化 `product` 行**：
    - 统一调用 `lockProductRow(manager, productCode)`
      → `SELECT code FROM product WHERE code = ? FOR UPDATE`（`backend/src/common/utils/product-lock.util.ts`）；
    - **InnoDB 行锁在事务结束（COMMIT/ROLLBACK）时才释放**，天然覆盖提交点：
      后到者阻塞到先到者**提交完成**，随后读到的一定是**已提交**的确认结果；
    - 三条 BOM 写事务的**产品行锁都是事务内第一条语句**；`update`/`remove` 的 `product_code`
      定位查询移到**事务外**（见下），以保证取锁是第一条语句、其后的引用判定读到最新已提交数据；
    - `confirm`：`lockOrder`（`sale_order` 行 FOR UPDATE）→ `lockProductRow` → 读既有工单/写入。
    - **锁顺序统一为「产品行锁先于 `bom` 行锁」**，`confirm` 为「`sale_order` 行 → 产品行」；
      BOM 事务从不对 `sale_order` 加锁（引用判定是普通读），故与 `confirm` 不构成死锁环。
    - **读一致性约束（关键）**：MySQL REPEATABLE READ 的快照在事务内**第一次一致性读**时建立，
      锁定读不建立快照 —— 故产品行锁必须是事务内第一条语句，否则引用判定会读到过期快照而失效。
    - **超时**：沿用 InnoDB `innodb_lock_wait_timeout`（默认 50s），不再自设 5s 命名锁超时。
    - **未引入新依赖**：仅使用 InnoDB 行锁，不引入 Redis / 会话表等未批准组件。
  - **单测断言**（替身）：`boms.service.spec.ts` 16 例（含「产品行锁为事务内第一条语句」「定位在事务外」
    「顺序：产品行锁 → bom 行锁 → 引用判定 → 写入」「不得再出现 GET_LOCK/RELEASE_LOCK」回归护栏）；
    `orders.service.spec.ts` 8 例（含「产品行锁早于读既有工单」「与 BOM 同源锁语句」「不再使用产品级命名锁」）。
  - **真实 MySQL 多连接并发测试**：`backend/test/bom-confirm-race.db-e2e-spec.ts`（A 互斥 / **B 决定性用例** /
    C 反向 / D 多连接争用）—— ⚠️ **本轮未执行**（环境未注入 `DB_PASSWORD`，且未获授权隔离库），详见 §6.3、§7.1。
  - **⚠️ 结论边界**：第二轮修复目前**仅由替身顺序断言支撑**；**真实 MySQL 多连接并发验证尚未执行**，
    故**不得宣称「并发缺陷已修复/已关闭」**。
- **精确十进制**：`qty` 全链路按字符串传递（DTO 正则校验 `^\d+(\.\d+)?$`，`>0`），不经 JS `number` 运算。
- **批次唯一性**：`batch_no` 唯一；插入捕获 `ER_DUP_ENTRY`(1062) 转 30002，不透传 500。
- **审计同事务**：BOM/物料/批次写操作与 `audit_log` 写入在**同一事务**内完成。

### 5.2 B6 追溯一致性

- **SN 精确**：`sn` 为唯一主键，查询为精确匹配，不用模糊结果冒充唯一追溯。
- **身份可信**：`operatorId` 取自 `request.user.id`（JWT 解析器输出），**不接受请求体传入**。
- **关联校验**：`task` 必须属于对应工单（跨工单 → 10002/10003）；设备、批次必须存在。
- **快照更新**：`PATCH` 的 SQL **不含 `produced_at`**，不伪造过去事件（单测断言 UPDATE 语句不含该列）。
- **一个 SN 一个快照一个批次**：由实体主键 + 单值列保证。
- **coverage / limitations / dataSource**：详情、页面与导出均保留；明确「工单工序/检验仅为关联上下文，不代表该 SN 已证实逐工序、逐件检验历史」。

### 5.3 B7 事务与状态一致性

- **状态变更校验 `expectedStatus`**：与当前状态不符 → 30003，防止覆盖他人已完成操作。因 Q3 未批准，当前任何流转在通过校验后仍返回 30006。
- **设备更新 / `equipment_log` / 审计同事务**：写入入口关闭时该路径不产生任何写入。
- **操作人与时间由服务端确定**：来自认证身份与服务端时间。
- **EQP-SMT-006 演示约束**：固定「维修中 / 加热区故障」；若人工变更与演示固定约束冲突 → 30003（契约 §6.7 第 355 行）。
- **OEE**：缺计划生产时间 / 设备产出归属 / 理想节拍时返回 `oee:null` + `calculationStatus:"insufficient_data"` + `missingInputs`；**不用随机数、默认值或产线良品率冒充**。
- **日期区间**：沿用统一半开区间口径（`startDate <= t < endDate+1d`），防边界漏算。
- **未连接真实 MQTT/PLC**：无自动设备控制。

### 5.4 B9 身份与授权

- **复用现有接入点**：沿用 `AuthGuard` + `RolesGuard` + `IDENTITY_RESOLVER`，**未建立并行第二套鉴权**。
- **真实可信身份**：`JwtIdentityResolver` 只从 `Authorization: Bearer` 取令牌；**不接受请求体、自定义身份头、固定账号或前端预览角色**。测试身份替身只在测试注入。
- **JWT 严格校验**：签名、算法（仅 `HS256`）、`sub` / `iat` / `exp` / `iss` / `aud` 全部校验（`jose` 白名单 + `clockTolerance: 0`）。过期 → 20002；签名/声明非法 → 20001。
- **每次认证读库**：核对当前 `sys_user.enabled` / `role`；停用账号 → 20004（403）；角色变化即时生效，不沿用旧 JWT 的权限。
- **密码哈希**：Argon2id；占位串 / 空串 / 旧格式一律判为不匹配（20003），**不重导账号、不覆盖既有密码、不暴露 `password_hash`**。
- **最后 admin 并发保护**：事务内对目标行 `FOR UPDATE`，若变更会使「启用 admin」集合为空，则对全部启用 admin 行 `FOR UPDATE` 复核，确认无其它启用 admin 才允许；否则 30002。并发操作被串行化，无法绕过。
- **普通用户不能改自身 role/enabled**：`PATCH /users/me` 类入口不开放；自身资料接口不接收 `role`/`enabled`。
- **权限矩阵覆盖 B1—B10 与 AI 接口**：见 `common/auth/permission-matrix.ts`；`GET /role-permissions` 返回只读清单。
- **日志只读**：不提供 `audit-logs` / `ai-query-logs` 的修改或删除接口。
- **前端角色失效 / 401 / 403 / 退出**：401 → 清理内存令牌并跳登录（仅触发一次）；403 → 提示无权限；退出 = 清空内存令牌（**不虚报即时吊销能力**，与 Q4-2 一致）；重复提交由 `useSubmitGuard` 同步加锁防抖。

### 5.5 脱敏（贯穿数据流）

- `password_hash` 只在登录/改密路径按需读取（`select:false`），**不进日志、异常、响应、交接文档、截图或测试输出**；用户响应 DTO 不含该字段（单测断言 `JSON.stringify(result)` 不含 `password_hash`）。
- 审计明细写入前经 `redactForLog` 口径处理（顺序：连接串 → `Bearer` → `key=value` → JWT）；既有 `redact-coverage.spec.ts` 强制新增 logger 调用被包裹。
- 新增模块**未新增任何 `logger.error/warn` 调用**，故未扩大脱敏面。
- SN 导出文件名经 `sanitizeExportFileName` 消毒（去路径分隔符与控制字符、限长、白名单字符），导出内容不含账号敏感信息。

---

## 6. 测试记录（实际命令 / 环境 / 退出码 / 数量 / 结果）

### 6.1 执行结果汇总（2026-10-13 初版 / **2026-10-14 P2 第二轮修复轮复跑**）

> 下表数量为 **2026-10-14 第二轮（产品行锁）复跑**的实际输出。

| 类别 | 命令 | 退出码 | 数量 | 结果 |
|---|---|---|---|---|
| 后端单元测试 | `npx vitest run`（backend） | 0 | 41 文件 / **378 例** | ✅ 全部通过 |
| 后端无数据库 HTTP e2e | `npm run test:e2e` | 0 | 4 文件 / **43 例** | ✅ 全部通过 |
| 后端 lint | `npx oxlint src/ test/` | 0 | 215 文件 | ✅ 0 error / 4 warning（均在既有文件，非本轮新增） |
| 后端完整 TS 检查 | `npx tsc --noEmit -p tsconfig.json` | 0 | — | ✅ 0 error |
| 后端构建 | `npx tsc -p tsconfig.build.json --outDir <临时目录>` | 0 | — | ✅ 0 error（见下方环境注） |
| 前端测试 | `npx vitest run`（frontend） | 0 | 24 文件 / **258 例** | ✅ 全部通过（本轮未改前端） |
| 前端类型检查 | `npx vue-tsc -b` | 0 | — | ✅ 0 error |
| 前端 lint | `npx oxlint src/` | 0 | 109 文件 | ✅ 0 error / 1 warning（既有 `router/redirect.ts` 控制字符正则，非本轮新增） |
| 前端构建 | `npm run build` | 0 | — | ✅ 成功（仅 chunk >500kB 提示，非错误） |
| **真实 MySQL 多连接并发** | `npm run test:e2e:db`（`bom-confirm-race`） | — | **未执行** | ❌ 环境未注入 `DB_PASSWORD`，未获授权隔离库（见 §7.1） |

**⚠️ 构建环境注**：`npx nest build` 被沙箱的「批量删除保护」拦截
（`nest-cli.json` 的 `deleteOutDir: true` 会在构建前清空 `dist/`，触发 SAFE_DELETE 阈值告警），
该拦截**与代码无关**。为验证源码可编译，改用 `tsc -p tsconfig.build.json --outDir <临时目录>`，
退出码 0、0 error，随后删除临时目录。**这不代表 `nest build` 的 `deleteOutDir` 行为已在本环境验证通过**，如实标注。

**本轮测试改动**：`boms.service.spec.ts` 改为「产品行锁协议」断言（**16 例**）；
`orders.service.spec.ts` 改为「confirm 产品行锁协议」断言（**8 例**）；
`test/bom-confirm-race.db-e2e-spec.ts` 重写为**行锁覆盖提交点**的多连接验证（A 互斥 / **B 决定性用例** / C 反向 / D 争用）——**本轮未执行**。

> 未复制任何旧统计冒充本轮结果；以上数量均为 2026-10-14 本轮实际执行输出。
>
> **历史轮次**：首轮（2026-10-13）后端单元 367 例；第二轮第一版（命名锁）377 例；
> 当前（第二轮行锁）**378 例**。前两轮均未通过复审（P2 并发缺陷）。

### 6.2 §九 测试要求覆盖对照

| # | 要求 | 覆盖文件 | 类型 |
|---|---|---|---|
| 1 | BOM 重复、引用保护、十进制及并发约束 | `materials/boms.service.spec.ts`（**含 P2 第二轮「产品行锁协议」断言，16 例**） | 单元（替身） |
| 1b | 订单确认与 BOM 写入的**共同互斥协议**（P2 修复） | `orders/orders.service.spec.ts`（「confirm 产品行锁协议」断言，8 例） | 单元（替身） |
| 1c | **真实 MySQL 多连接并发**（P2 修复验证） | `test/bom-confirm-race.db-e2e-spec.ts` | 真实 MySQL 多连接（**本轮未执行**） |
| 2 | 批次唯一性、非法日期和关联不存在 | `material-batches/material-batches.service.spec.ts` | 单元（替身） |
| 3 | SN 跨工单 task 拒绝、快照更新及导出限制说明 | `sn-traces/sn-traces.service.spec.ts` | 单元（替身） |
| 4 | 设备 expectedStatus 冲突、事务失败传播及 OEE 缺输入 | `devices/devices.service.spec.ts` | 单元（替身） |
| 5 | 三角色接口权限矩阵 | `test/s10-permissions.e2e-spec.ts` | HTTP e2e（身份替身 + mock 数据源） |
| 6 | JWT 伪造、过期、算法/签发者/受众错误 | `common/auth/token.service.spec.ts` | 单元（真实 jose 签名/校验） |
| 7 | 停用账号和角色变化对已有令牌的即时权限影响 | `common/auth/jwt-identity-resolver.spec.ts` | 单元（替身数据源） |
| 8 | 最后一个启用 admin 的并发保护 | `auth/users.service.spec.ts` | 单元（替身事务） |
| 9 | 日志及错误响应脱敏 | `auth/users.service.spec.ts`、`auth/auth.service.spec.ts`、`common/utils/redact.util.spec.ts`、`redact-coverage.spec.ts` | 单元 |
| 10 | 前端加载、空数据、失败、重复提交、权限变化 | `composables/useAsyncTask.spec.ts`、`useSubmitGuard.spec.ts`、`stores/auth.spec.ts`、`services/s10-services.spec.ts` | 前端逻辑（node 环境） |

### 6.3 测试环境说明与「测试类型」严格区分

- **静态检查**：oxlint（后端/前端）、`tsc --noEmit`、`vue-tsc -b`。
- **执行方自测**：以上所有命令均为**执行方自测**，**不等于**独立审查通过。
- **身份或数据库替身测试**：`s10-permissions.e2e-spec.ts` 使用**身份替身 + mock 数据源**；服务层 spec 使用**替身 DataSource / 事务**。→ **不代表**真实事务、锁或多连接隔离通过。
  P2 第二轮的产品行锁断言**同样是替身测试**——它只能证明「SQL 语句与调用顺序正确、两侧使用同一锁语句、
  不存在已废弃的命名锁」，**不能**证明真实 MySQL 下行锁确实互斥、且覆盖事务提交点。
  后者必须由真实多连接测试证明（见下）；**这正是第一版修复被复审推翻的教训**：
  替身只验证 SQL 顺序，无法发现「锁在提交前被释放」这类真实可见性问题。
- **真实隔离 MySQL**：❌ **未执行**。`test:e2e:db`（`vitest.config.db-e2e.ts`，真实 MySQL）本轮**未运行**——
  环境未注入 `DB_PASSWORD`，且未获授权的隔离数据库环境。**数据库连接拒绝但测试退出 0 不代表真实数据库通过**。
  重写的 `test/bom-confirm-race.db-e2e-spec.ts` 已写好并在缺口令时**主动抛错拒绝执行**
  （不会以 mock 结果冒充「真实并发验证通过」），待获授权隔离库后可直接运行。
  其 **B 组为决定性用例**：确认事务持锁**未提交**期间断言 BOM 删除仍被阻塞，
  提交后才继续并读到已确认业务 → 30004——正是复审指出的窗口。
- **真实 JWT HTTP**：❌ **未执行**。JWT 签名/校验用**真实 jose 库**在单元层验证，但**未**在真实 HTTP + 真实数据库下跑通登录链路。
- **真实浏览器测试**：❌ **未执行**。前端为纯逻辑单测（node 环境，无 jsdom）。**组件逻辑测试不代表 Chrome/Edge DOM 闭环通过**。

> **临时副本说明**：任务书要求「优先在临时副本运行构建与测试」。本轮直接在项目目录运行（未做临时副本 + junction 挂载），原因：本轮未触及 `node_modules` 重装、未做破坏性操作，且 `dist` 产物不影响源码判定。**这是一处与任务书建议的偏差，如实标注。**

---

## 7. 未验证项 · 已知问题 · 回归风险

### 7.1 未验证项

1. **真实 MySQL 链路**：所有新模块的 SQL（BOM 引用保护、批次唯一冲突、SN 关联校验、最后 admin 并发保护、`equipment_log` 查询）**未在真实 MySQL 上执行**。
2. **真实 JWT 端到端**：`POST /sessions` → 携带令牌访问业务接口 → 停用账号即时失效，**未在真实 HTTP 环境验证**。
3. **真实浏览器闭环**：五个新页面（物料/SN/设备/用户/日志）的加载、空数据、失败、权限变化**未在真实浏览器**验证。
4. **并发实测**：最后 admin 并发保护、BOM 引用保护并发、批次唯一并发**仅有单元替身**，未做真实多连接并发压测。
   - **P2 修复专项**：`test/bom-confirm-race.db-e2e-spec.ts`（真实 MySQL 多连接，验证订单确认与 BOM 写入
     共用**同一 `product` 行锁**、且行锁覆盖**事务提交点**）**本轮未执行**——环境未注入 `DB_PASSWORD`、未获授权隔离库。
     **该测试已就绪，待授权后必须补跑**；在此之前「P2 并发缺陷已修复」的结论**仅由替身断言支撑**，
     且第一版（命名锁）正是在该测试缺位的情况下被复审判定不成立 —— **不得据此宣称缺陷已关闭**。
5. **`test:e2e:db`（真实数据库 e2e）**：未运行。
6. **AI 服务（ai-service）**：本轮**未触及**，故**未运行** S8/S9 Python 回归。理由：未修改任何 ai-service 文件或公共协议。

### 7.2 已知问题 / 有意保留的行为

1. **设备状态迁移写入关闭**：`POST /devices/{code}/state-transitions` 注册但对任何流转返回 30006（Q3 未批准）。前端保留入口仅为展示拒绝原因。
2. **密码强度策略未强制**：改密接口不校验「≥8 且含字母数字」（Q4-3 未具体批准）。批准后需补校验。
3. **改密后令牌不即时吊销**：与 Q4-2 一致，旧令牌在 2 小时有效期内仍可用。
4. **`password_hash` 为占位串**：种子数据未变；登录只能对已重置为 Argon2id 哈希的账号成功。账号重置属 AUTH-3「另行授权」。
5. **OEE 恒返回 `insufficient_data`**：因缺班次日历/设备产出/理想节拍输入，符合契约预期，非缺陷。
6. **前端骨架预览**：仍保留（生产构建不可用），与正式认证完全分离。

### 7.3 回归风险

1. **`route-registration.e2e-spec.ts` 的实体注册清单**：新增 5 个实体已同步登记；**后续新增实体必须同步该清单**，否则 `autoLoadEntities` 漏注册会在事务内抛 No metadata。
2. **`auth.guard.ts` 文案变更**：由「未实现登录」改为令牌口径；若既有测试断言旧文案需同步。
3. **前端 `DataSourceTag` prop**：新页面统一用 `:data-source` / `:data-label`；如后续有人改回 `:meta` 会导致 `vue-tsc` 报错。
4. **`JwtIdentityResolver` 每请求读库**：为满足 Q4-2 即时失效，每次认证多一次轻量查询；高并发下需关注数据库压力（当前未做压测）。
5. **（P2 第二轮）产品行锁是跨模块契约**：`lockProductRow(manager, productCode)`
   （`SELECT code FROM product WHERE code = ? FOR UPDATE`）是 BOM 写事务与订单确认的**共同互斥协议**。
   - **后续任何**对同一产品做「引用保护判定」或「生成关联业务」的新入口，**必须复用同一语句/同一 `product` 行**，
     否则重新引入竞态。
   - **⚠️ 必须保持「产品行锁是事务内第一条语句」**：MySQL REPEATABLE READ 的快照在**第一次一致性读**时建立，
     锁定读不建立快照。若在取锁前先做普通 `SELECT`（建立过早快照），其后的引用判定会读到**过期**数据 → 保护失效。
     `update`/`remove` 因此把 `product_code` 定位查询放在**事务外**，**不得**改回事务内普通读。
   - **锁顺序不得反转**：统一「产品行锁 → `bom` 行锁」；`confirm` 为「`sale_order` 行 → 产品行」。
     若反转（例如先锁 `bom` 行再锁产品行）会与 `create`（产品行 → 插入 bom）形成死锁环。
   - 依赖 InnoDB `innodb_lock_wait_timeout`（默认 50s）；长事务会放大等待，需关注（当前未做真实并发压测）。
6. **（P2 第二轮）`confirm` 现在多锁一个 `product` 行**：与既有「工单编号锁（`GET_LOCK`，仅用于编号分配）」叠加，
   单次确认在「`sale_order` 行 + `product` 行 + 编号命名锁」上各持锁一次；
   高并发下需关注锁等待放大效应（当前未做真实并发压测，见 §7.1 第 4 项）。
   注：**工单编号分配仍使用会话级 `GET_LOCK`**，与本轮修复无关 —— 其正确性由 `work_order.code` 唯一约束 + 重试兜底，
   不依赖锁覆盖提交点。

---

## 8. 下一阶段接入说明

1. **Q3 批准后**：放开 `resolveDeviceTransition` 状态机（当前保留定义与校验、返回 30006），恢复写入路径 + `equipment_log` + 审计同事务；前端去掉「入口关闭」提示，按允许流转表渲染按钮。
2. **Q4 剩余项批准后**：
   - 密码强度策略：在改密 DTO/服务补校验（10001）。
   - 改密后令牌失效范围：如需即时吊销，须引入令牌版本或黑名单（涉及未批准的存储依赖，需单独批准）。
3. **真实环境验证**：在获授权的隔离 MySQL 上运行 `test:e2e:db`；补 S10 真实数据库 e2e（BOM 引用保护、批次唯一、最后 admin 并发、SN 关联）。
   - **优先补跑** `test/bom-confirm-race.db-e2e-spec.ts`（P2 修复的真实并发验证，见 §9.1）——这是复审放行的前置条件之一。
4. **S11**：SPC（B11）、MRP-lite（B12）、PWA、开放集成 API（B14）仍保持未启用（`route-registration` 已断言 404）。
5. **F1（RAG 知识问答）**：仍未实现；如需推进，另开会话。

---

## 9. 提交声明

- 本文件与对应代码提交为 **「待独立审查」** 状态。
- **不自行宣布**：独立审查通过、完整业务验收通过、上线批准。
- 所有未执行项（真实数据库 / 真实 JWT HTTP / 真实浏览器 / 真实并发 / Python 回归）已在 §6.3、§7.1 明确标注为**未验证**。

### 9.1 S10 复审 P2 缺陷修复记录（2026-10-14）

**第 1 轮（已被复审判定不成立）**

| 项 | 内容 |
|---|---|
| 审查意见 | [P2] BOM 引用保护存在并发竞态：`boms.service.ts` 与 `orders.service.ts` 无共同锁定资源，可能并发提交形成「已确认订单对应的 BOM 被修改/删除」；交接文档「避免竞态绕过」表述不成立 |
| 修复方式 | 引入会话级命名锁 `GET_LOCK`（`mes:bom-product:{productCode}`），BOM 写事务与订单确认共用；在事务回调 `finally` 中 `RELEASE_LOCK` |
| 判定结果 | ❌ **复审不通过** —— 见第 2 轮 |

**第 2 轮（本轮 · 待复审）**

| 项 | 内容 |
|---|---|
| 复审意见 | [P2] **产品级命名锁在事务提交前被释放**：`RELEASE_LOCK` 在事务回调 `finally` 中执行，而 TypeORM 在回调返回后才 `COMMIT` → 命名锁未覆盖提交点，仍可形成「已确认订单对应的 BOM 被修改/删除」；且替身测试只验证 SQL 顺序，无法发现该真实可见性问题 |
| 修复文件 | `backend/src/common/utils/product-lock.util.ts`（**改为 `lockProductRow`：`SELECT code FROM product WHERE code = ? FOR UPDATE`**）；`backend/src/modules/materials/boms.service.ts`（create/update/remove）；`backend/src/modules/orders/orders.service.ts`（confirm） |
| 修复方式 | **弃用会话级命名锁**，改用 **InnoDB `product` 行级排他锁**：两条事务在临界区前锁定**同一持久化产品行**。行锁在**事务提交时**才释放 → 覆盖提交点，后到者阻塞到先到者**提交完成**，随后读到已提交数据。产品行锁为**事务内第一条语句**（`update`/`remove` 的定位查询移到事务外）；锁顺序统一为「产品行 → bom 行」，`confirm` 为「sale_order 行 → 产品行」 |
| 新增/改写测试（替身） | `boms.service.spec.ts`（16 例）、`orders.service.spec.ts`（8 例）：断言产品行锁为事务内第一条语句、早于引用判定与写入、两侧同源锁语句，并含「不得再出现 `GET_LOCK`/`RELEASE_LOCK`」回归护栏——**已执行，退出码 0** |
| 真实 MySQL 测试 | `test/bom-confirm-race.db-e2e-spec.ts` 重写为**行锁覆盖提交点**验证：A 互斥 / **B 决定性用例（未提交期间 BOM 删除被阻塞，提交后 30004）** / C 反向 / D 多连接争用——⚠️ **未执行**（未注入 `DB_PASSWORD`、未获授权隔离库） |
| 文档更正 | §5.1 已改写为第二轮方案（含第一版失效原因），§7.3 更新锁协议与「第一条语句」约束，§6.1 更新为本轮复跑数据 |
| 结论边界 | 「P2 已修复」目前**仅由替身断言支撑**；**真实 MySQL 多连接并发验证尚未执行**。第一版正是因该验证缺位而被推翻，故本轮**明确不宣称缺陷已关闭**；须在获授权隔离库后补跑 `test:e2e:db`（尤其 B 组决定性用例）方可确认。本提交仍为**待复审**。 |

---
