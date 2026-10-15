# S6: 生产报工与质量检验（B3 & B4）交接与整改验证报告

> 阶段：S6（B3 生产报工 + B4 质量检验）第二轮整改与全量回归  
> 日期：2026-10-11  
> 环境：Windows, Node.js v24.19.0, npm 11.17.0, TypeScript 5.8 / 6.0  
> 状态：代码修复、全量测试通过、全量构建通过。依规交付，不自行宣布生产验收通过或上线。

---

## 1. 审查问题整改矩阵（逐项对照）

| 序号 | 优先级 | 审查意见摘要 | 根因分析 | 整改落实措施 | 代码定位 |
|---|---|---|---|---|---|
| 1 | **P1** | 后端基础集成失败：控制器引用不存在的装饰器；新 DTO 公共模块相对路径错误；工单服务调用未导入函数 | 模块相对深度为 3 层误用 2 层相对路径；误用未实现的 `require-role`；工单状态机未导出/导入完整函数 | 修正所有 DTO 引用至 `../../../common/`；控制器规范接入 S5 认证守卫；工单服务导入 `resolveTaskTransition` 并修复状态机断言 | `reports.controller.ts`<br>`create-report.dto.ts`<br>`work-orders.service.ts` |
| 2 | **P1** | 新控制器未接入现有认证和权限守卫 | 控制器未配置 `@UseGuards(AuthGuard, RolesGuard)` 与方法级 `@RequireRoles`，缺少 fail-closed 拦截 | 统一注入 S5 `AuthGuard` 与 `RolesGuard`，配置 `@RequireRoles('admin', 'manager', 'operator')`，增加 E2E 匿名 401 探针覆盖 | `reports.controller.ts`<br>`quality-inspections.controller.ts`<br>`defects.controller.ts` |
| 3 | **P1** | 重复提交防护回退（在 await 后加锁存在竞态窗口） | 前端提交方法在异步 `validate()` 之后才设置 `loading`，快速连击会双双通过校验并重复发请求 | 引入 `useSubmitGuard`，在任何 `await` 之前同步抢占锁，重复触发立即忽略；配套并发双击单次执行回归测试 | `ReportsView.vue`<br>`QualityInspectionsView.vue`<br>`reports-inspections.spec.ts` |
| 4 | **P2** | 前端查询参数传错层级（嵌套 `{ params: query }`） | `services/http.ts` 的 `httpGet` 二级参数本身为 `params`，外层再包 `{ params }` 导致 Axios 序列化嵌套 | 修改 `ReportsService.list` 与 `QualityInspectionsService.list` 为直接传 `compactParams({ ...query })`，支持 `signal` 取消 | `frontend/src/services/reports.ts`<br>`frontend/src/services/quality-inspections.ts` |
| 5 | **P2** | 报工总数与列表使用不同日期边界 | `reports.service.ts` 先计算 count，之后才将 `endDate` 递增一天，导致当天数据在列表却不计入 total | 列表查询先统一计算半开区间边界（`endDate + 1d 00:00:00`），再分别代入 count 与 rows 查询，保证总数与列表一致 | `backend/src/modules/reports/reports.service.ts`<br>`backend/src/common/utils/date-only.util.ts` |
| 6 | **P2** | 创建响应时间被重复调整时区 | 创建报工/质检时手动加 8 小时和时区偏移再调用 `toShanghaiRfc3339`，导致二次偏移 | 统一采用数据库 `UNIX_TIMESTAMP(col)` 返回秒级 epoch，通过 `toShanghaiRfc3339(new Date(epoch * 1000))` 一致格式化 | `reports.service.ts`<br>`quality-inspections.service.ts` |
| 7 | **P2** | 新校验未达到既有边界（缺容量上限、BIGINT 检查宽松） | ID 仅正则检查未限制 BIGINT 有符号上限（$2^{63}-1$）；DTO 缺少 `MAX_INT` 容量上限与字段长度限制 | 引入 `isValidDecimalId` 复用两层校验；DTO 增加 `MAX_INT` (2147483647) 上限，字符串长度限制；报工服务增加工序和工单累计溢出保护 | `dto/create-report.dto.ts`<br>`dto/create-quality-inspection.dto.ts`<br>`quality-inspections.service.ts` |
| 8 | **P2** | 新页面未继承统一状态处理；NG 缺陷写死一般不良 | 页面 `catch` 吞异常未展示 403 / 500 / 超时提示；`DataSourceTag` 传参写成 `source/label`；无法录入多缺陷 | 引入 `useAsyncTask` 驱动统一 `LoadingState` / `ErrorState` / `EmptyState`；失败调用 `showWriteError` 提示“结果未确认”；正确传递 `:data-source` / `:data-label`；提供动态不良明细增删与数量配平 | `ReportsView.vue`<br>`QualityInspectionsView.vue` |
| 9 | **P2** | 已批准工单流转被改回“Q2 未决” | 状态机对暂停/恢复/关闭直接返回 `blocked-q2`，回退了已批准行为 | 状态机实现 5 组 Q2-1 批准流转（`在产->暂停`、`暂停->在产`、`待启动->关闭`、`在产->关闭`、`暂停->关闭`）为 `allowed`，终态与非法流转返回 `invalid`；更新单测断言 | `work-order-state-machine.ts`<br>`work-order-state-machine.spec.ts` |
| 10 | **P2** | 任务分配规则仍不完整（车间产线未校验、仅改产线漏校验设备） | `updateTask` 仅提交 deviceCode 时才校验设备；未校验目标产线是否属于任务车间；仅修改产线未重新校验已分配设备与新产线匹配 | 提取修改后的目标状态，统一对完整分配结果进行协同校验：校验目标产线在任务车间范围内、已有或新分配设备均须处于“运行中”且产线与车间匹配；新增完整单测 | `work-orders.service.ts`<br>`work-orders.service.spec.ts` |
| 11 | **P2** | 报工与质检锁顺序相反（潜在死锁） | 报工先锁任务后锁工单；质检先锁工单后锁任务；并发时存在环路死锁条件 | 统一全局加锁顺序为严格的父子层级：`work_order FOR UPDATE` 先锁，`work_task FOR UPDATE` 后锁。报工先根据任务读取工单 ID，再按序锁定；增加锁序断言单测 | `reports.service.ts`<br>`quality-inspections.service.ts`<br>`reports.service.spec.ts`<br>`quality-inspections.service.spec.ts` |
| 12 | **P2** | 回滚证据被夸大 | 单测事务替身仅执行回调，未保存/恢复数据，证明的是异常传播而非 MySQL ACID 回滚 | 如实更正单测用例命名为“服务级故障传播与事务中断”，并在交接文档明确标示：真实数据库 ACID 回滚与并发累计仍列为未验证（受限于当前环境与数据库授权边界） | `reports.service.spec.ts`<br>`quality-inspections.service.spec.ts`<br>`docs/handovers/s6-reports-inspections.md` |

---

## 2. 核心架构与业务实现细节

### 2.1 B3 生产报工（Reports）
- **路由前缀**：`POST /api/v1/reports`、`GET /api/v1/reports`。
- **权限矩阵**：复用 `AuthGuard, RolesGuard`，允许 `admin, manager, operator` 三角色访问。匿名请求严格触发 `20001 UNAUTHENTICATED`（fail-closed）。
- **统一锁顺序与事务闭环**：
  1. 通过轻量元数据读取任务所属 `work_order_id`；
  2. **统一锁顺序第一步**：`SELECT id, status, done_qty FROM work_order WHERE id = ? FOR UPDATE` 锁定工单行，校验处于 `在产`；
  3. **统一锁顺序第二步**：`SELECT * FROM work_task WHERE id = ? FOR UPDATE` 锁定工序任务行，校验处于 `在产`；
  4. 校验工序累计数量与工单完成数量不会发生 INT 溢出；
  5. 写入 `report` 记录；
  6. 累计工序 `work_task.good_qty` 与 `bad_qty`；
  7. 查询该工单下 `seq` 最大（末道工序）任务；仅当当前报工任务为末道工序时，才将 `goodQty` 增量累加至 `work_order.done_qty`；中间工序不累加工单完工量；
  8. 事务内同步写入 `audit_log`（操作人来源于当前认证令牌，绝不从客户端传入可疑 userId）；
  9. 服务层任何一步异常（如审计失败）均中断流程并向外抛出异常。

### 2.2 B4 质量检验与不良明细（Quality Inspections & Defects）
- **路由前缀**：`GET/POST /api/v1/quality-inspections`、`GET /api/v1/quality-inspections/:id`、`GET /api/v1/defects`。
- **统一锁顺序**：
  1. **统一锁顺序第一步**：`SELECT * FROM work_order WHERE id = ? FOR UPDATE` 锁定工单；
  2. **统一锁顺序第二步**：若指定 `taskId`，执行 `SELECT * FROM work_task WHERE id = ? FOR UPDATE` 锁定任务；
  - 报工与质检锁顺序完全同向（`work_order -> work_task`），统一锁顺序规避工单与任务层级间交叉死锁，但不能完全排除复杂多表并发或间隙锁引起的其他死锁。
- **校验边界**：
  - `OK` 检验：`ngQty = 0`，不允许存在不良明细；
  - `NG` 检验：$0 < ngQty \le checkQty$，必须包含至少 1 项不良明细，每项数量 $\ge 1$，所有明细数量之和必须精确等于 `ngQty`；
  - 任务关联校验：若指定 `taskId`，必须校验其确属当前 `workOrderId`，否则抛出 `10002 INVALID_REFERENCE`。
- **服务级故障传播**：
  - 写入 `qc_record`、若 NG 批量插入 `defect` 明细、写入 `audit_log` 均在同一事务上下文；明细插入故障向外传播中断。

### 2.3 状态机与任务分配完整规则
- **工单状态流转（Q2-1 已批准规则）**：
  - 允许流转（7 组）：主线 `待启动 -> 在产`、`在产 -> 完工`；已批准 `在产 -> 暂停`、`暂停 -> 在产`（恢复）、`待启动 -> 关闭`、`在产 -> 关闭`、`暂停 -> 关闭`。
  - 终态禁止：`完工 -> *`、`关闭 -> *` 均禁止（返回 `invalid`）。
  - 非法流转：`待启动 -> 暂停`、`待启动 -> 完工`、`在产 -> 待启动`、同状态迁移等均返回 `invalid`。
- **任务分配规则（updateTask 完整结果校验）**：
  - 合并计算目标状态（`targetStart`, `targetEnd`, `targetOperatorId`, `targetProdLine`, `targetDeviceCode`）；
  - 时间校验：开始时间不得晚于结束时间；
  - 操作员校验：目标操作员必须存在且 `enabled = 1`；
  - 产线车间范围校验：目标产线必须属于任务车间（通过 `device` 与 `process_route` 匹配车间与产线关系）；
  - 目标设备完整校验：无论是本次提交还是原有已分配设备，目标设备必须存在且处于 `运行中`，且其产线与车间必须与任务目标产线及车间完全一致。

### 2.4 前端一致性与交互防护
- **提交防抖/并发锁**：`useSubmitGuard` 在任何 `await`（包括表单校验）之前**同步加锁**，连击与快速回车被安全拦截；
- **请求失败反馈**：超时与网络异常展示 `结果未确认，请查询核对。（本次提交不会自动重发，请刷新列表确认）`，403/400 展示详细错误原因与 `X-Request-Id`；
- **列表轮次与取消**：使用 `useAsyncTask` 配合 `AbortSignal`，切页或新查询自动取消在途请求，迟到响应不覆盖新数据；
- **数据源标识**：在表单和列表清晰展示 `demo`（演示数据）或 `enterprise-master` 标识。

---

## 3. 可复现的自动化验证证据

### 3.1 后端单元测试（Vitest）
- **执行命令**：`npm test`（工作区：`backend/`）
- **退出码**：`0`
- **结果统计**：**21 个测试套件全过，169 个测试用例全过**
```text
 RUN  v4.1.11 D:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend

 ✓ src/common/utils/redact-coverage.spec.ts (8 tests) 49ms
 ✓ src/common/utils/redact.util.spec.ts (10 tests) 7ms
 ✓ src/common/utils/bigint.util.spec.ts (4 tests) 7ms
 ✓ src/common/utils/id.util.spec.ts (8 tests) 7ms
 ✓ src/modules/orders/order-status.spec.ts (16 tests) 8ms
 ✓ src/common/utils/datetime.util.spec.ts (3 tests) 7ms
 ✓ src/common/utils/rfc3339.util.spec.ts (9 tests) 8ms
 ✓ src/common/utils/date-only.util.spec.ts (6 tests) 8ms
 ✓ src/modules/orders/work-order-code.spec.ts (7 tests) 7ms
 ✓ src/modules/work-orders/work-order-state-machine.spec.ts (10 tests) 8ms
 ✓ src/common/filters/all-exceptions.filter.spec.ts (5 tests) 13ms
 ✓ src/common/dto/pagination.spec.ts (23 tests) 12ms
 ✓ src/common/utils/validation.util.spec.ts (9 tests) 5ms
 ✓ src/modules/orders/dto/confirm-order.dto.spec.ts (5 tests) 13ms
 ✓ src/modules/orders/dto/update-order.dto.spec.ts (6 tests) 12ms
 ✓ src/modules/work-orders/work-orders.service.spec.ts (10 tests) 9ms
 ✓ src/modules/orders/orders.service.spec.ts (3 tests) 7ms
 ✓ src/modules/quality-inspections/quality-inspections.controller.spec.ts (4 tests) 8ms
 ✓ src/modules/reports/reports.service.spec.ts (9 tests) 13ms
 ✓ src/modules/reports/reports.controller.spec.ts (4 tests) 7ms
 ✓ src/modules/quality-inspections/quality-inspections.service.spec.ts (10 tests) 11ms

 Test Files  21 passed (21)
      Tests  169 passed (169)
   Start at  02:46:27
   Duration  2.53s
```

### 3.2 后端 E2E 路由注册与 fail-closed 鉴权测试
- **执行命令**：`npm run test:e2e`（工作区：`backend/`）
- **退出码**：`0`
- **结果统计**：**2 个测试套件全过，14 个测试用例全过**
```text
 RUN  v4.1.11 D:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/backend

 ✓ test/app.e2e-spec.ts (8 tests) 529ms
 ✓ test/route-registration.e2e-spec.ts (6 tests) 286ms

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Duration  2.63s
```

### 3.3 后端 Lint 检查（Oxlint）
- **执行命令**：`npm run lint`（工作区：`backend/`）
- **退出码**：`0`
- **输出**：`Found 0 warnings and 0 errors. Finished in 17ms on 110 files with 96 rules using 20 threads.`

### 3.4 后端编译构建（NestJS Build）
- **执行命令**：`npm run build`（工作区：`backend/`）
- **退出码**：`0`
- **输出**：`nest build` 成功，无任何 TypeScript 编译与类型报错。

### 3.5 前端单元测试（Vitest）
- **执行命令**：`npm test`（工作区：`frontend/`）
- **退出码**：`0`
- **结果统计**：**16 个测试套件全过，194 个测试用例全过**
```text
 RUN  v4.1.11 D:/wordbuddy/AI重构软件全栈开发项目实战（基于Trae)培训资料/mes-upgrade-starter/frontend

 ✓ src/router/redirect.spec.ts (6 tests) 7ms
 ✓ src/utils/order-view.spec.ts (17 tests) 11ms
 ✓ src/services/api-error.spec.ts (30 tests) 15ms
 ✓ src/utils/format.spec.ts (10 tests) 11ms
 ✓ src/services/write-feedback.spec.ts (4 tests) 6ms
 ✓ src/composables/useDetailFlow.spec.ts (8 tests) 17ms
 ✓ src/config/permissions.spec.ts (31 tests) 15ms
 ✓ src/router/access.spec.ts (13 tests) 11ms
 ✓ src/composables/useSubmitGuard.spec.ts (5 tests) 22ms
 ✓ src/config/modules.spec.ts (12 tests) 18ms
 ✓ src/composables/useAsyncTask.spec.ts (10 tests) 9ms
 ✓ src/composables/useWorkOrderIndex.spec.ts (5 tests) 7ms
 ✓ src/layouts/layout.spec.ts (8 tests) 4ms
 ✓ src/services/http.spec.ts (14 tests) 21ms
 ✓ src/services/orders.spec.ts (14 tests) 19ms
 ✓ src/services/reports-inspections.spec.ts (7 tests) 33ms

 Test Files  16 passed (16)
      Tests  194 passed (194)
   Duration  930ms
```

### 3.6 前端生产构建（Vue-TSC + Vite）
- **执行命令**：`npm run build`（工作区：`frontend/`）
- **退出码**：`0`
- **输出**：`vue-tsc -b && vite build` 成功，所有视图与组件无类型报错，产物打包完成。

---

## 4. 边界、证据求真与未验证事项声明

1. **服务级故障传播测试 vs 真实数据库 ACID 回滚**：
   - 单元测试（`reports.service.spec.ts`、`quality-inspections.service.spec.ts`）中的事务替身为隔离环境 Mock 运行，其断言的是“当后续操作（如审计写入或不良明细写入）发生故障时，事务回调抛出异常并向外传播，后续业务步骤被中断”；
   - **真实 MySQL 引擎下的多表事务回滚与崩溃一致性**并未在本次隔离环境中直接断言（不具备真实生产数据库高危注入条件）；真实 ACID 回滚如实列为**未直接实测项**。
2. **统一锁顺序规避交叉死锁 vs 真实并发争用压测**：
   - 代码层面统一锁顺序（`work_order` 优先于 `work_task` 加锁），严格规避工单与任务层级间已知的交叉死锁，但不能完全排除极端复杂多表并发或间隙锁引起的其他死锁；
   - 单元测试中已验证单次操作中 `work_order FOR UPDATE` 索引严格小于 `work_task FOR UPDATE` 索引；
   - **真实数据库下的多连接高并发累计与行锁争用表现**仍列为**未直接实测项**（受限于受控环境与数据库授权限制，遵守准则不为了补充过度证据而绕过授权限制）。
3. **交付物规范与合规说明**：
   - 保持既有 18 张 MySQL 数据表结构绝对未修改（零 DDL 变动）；
   - 遵循角色权限矩阵，严格实施 fail-closed；
   - 遵循统一响应结构 `{code, message, data}` 与错误码规范；
   - 本次为 S6 执行工程师阶段交付物与隔离测试证据，不代表生产验收通过或真实上线。
