# 交接文档 — S1 建库 + 导数 — 2026-10-10

> **状态：已完成 · 已裁决通过。**
> 18 张表建成，企业主数据入库；6 张校验表**全部命中**期望值。
> `bom` 期望值口径已于 **2026-10-10 裁决修正为 28**（2 行「成品行」不计入），实测 28，通过。

---

## 1. 本会话做了什么

在 MySQL 8.4.9（实例 `MySQL841`，端口 3306）上执行 `db/schema.sql` 建库建表、`db/seed.sql` 导入企业主数据。
`smart_mes` 库建成，18 张表全部创建成功，6 份企业 Excel 的主数据已入库。
行数校验 **6/6 通过**；`bom` 的期望值口径经裁决修正后一致。全程未改动任何源码与源数据。

---

## 2. 文件清单

- **新增**：`docs/handovers/s1-db.md`（本文件）
- **新增（数据库对象）**：`smart_mes` 库；18 张表
- **修改**：无

> 明确未改动：`db/schema.sql`、`db/seed.sql`、`db/seed_from_excel.py`、`data/*.xlsx`。
> 未执行 `python db/seed_from_excel.py` 重新生成（`seed.sql` 导入本身未报错，不满足触发条件）。

---

## 3. 接口清单（本模块新增/实现的 API）

本模块为**纯数据库任务，不新增任何 API**。落库对象如下：

| 类别 | 表 | 行数 |
|---|---|---|
| **主数据（6）** | `product` / `device` / `material` / `bom` / `process_route` / `sys_user` | 15 / 13 / 24 / 28 / 10 / 23 |
| **业务（11）** | `sale_order` / `work_order` / `work_task` / `report` / `qc_record` / `defect` / `material_batch` / `sn_trace` / `equipment_log` / `alert` / `audit_log` | 空表（待阶段三演示数据） |
| **AI 日志（1）** | `ai_query_log` | 空表 |

**合计 6 + 11 + 1 = 18 张表**，与 `docs/api-contract.md` §1「6 主数据 + 11 业务 + 1 AI 日志，共 18 表」口径一致（`audit_log` 归入业务侧）。

---

## 4. 自测结果

### 4.1 命令与执行结果

环境：pwsh **7.6.6**；客户端 `D:\MySQL Server 8.4\bin\mysql.exe` v8.4.9；目标 `127.0.0.1:3306`。

| # | 命令（pwsh 7 实际执行） | 结果 |
|---|---|---|
| 0 | 连通性预检 `Test-NetConnection 127.0.0.1:3306` | `TcpTestSucceeded: True` |
| 1 | `mysql --default-character-set=utf8mb4 -h 127.0.0.1 -P 3306 -u root -e "source db/schema.sql"` | **EXITCODE=0**，18 表建成 |
| 2 | `mysql --default-character-set=utf8mb4 -h 127.0.0.1 -P 3306 -u root smart_mes -e "source db/seed.sql"` | **EXITCODE=0**，无报错 |
| 3 | 行数校验（见 4.2） | **6/6 通过** |
| 4 | `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='smart_mes'` | **18** |

**与原始指令的偏差（4 处，均为环境限制，不改变语义）：**

1. **`<` 重定向不可用。** 原文 `mysql -u root -p < db\schema.sql` 在 pwsh 7 下无法执行，报 `"<"运算符保留供将来使用`。改用 mysql 客户端内置的 `source` 命令，逐字节读取同一文件，语义等价。
2. **`mysql` 不在 PATH。** 改用完整路径调用。
3. **密码非交互注入。** 执行环境无 tty，`-p` 的终端提示无法响应；改用会话级环境变量 `$env:MYSQL_PWD` 单次注入，**未写入任何文件**。
4. **追加 `--default-character-set=utf8mb4`。** 保证中文主数据按 utf8mb4 解析，避免按 GBK 解码产生乱码。

### 4.2 行数校验

| 表 | 期望 | 实测 | 判定 |
|---|---|---|---|
| `product` | 15 | 15 | ✅ |
| `device` | 13 | 13 | ✅ |
| `material` | 24 | 24 | ✅ |
| `bom` | **28**（2026-10-10 裁决修正，原文档为 30） | **28** | ✅ |
| `process_route` | 10 | 10 | ✅ |
| `sys_user` | 23 | 23 | ✅ |

**6/6 通过。**

### 4.3 附加校验

- **字符集与排序规则**（实测，`information_schema`）：
  - 库默认：`utf8mb4` / **`utf8mb4_unicode_ci`** ✅
  - 18 张表：**全部** `utf8mb4_unicode_ci` ✅
  - 列级排序规则：无例外（仅 `utf8mb4_unicode_ci`）
  - 注：服务器默认排序规则为 `utf8mb4_0900_ai_ci`，与本库无关，勿混淆。
- **中文数据完整性抽查**（无乱码）：
  - `product` → `JC-PLC-2001 | PLC控制板卡-标准型 | 工业控制板卡` ✅
  - `device` → `EQP-SMT-006 | 回流焊炉(劲拓) | 维修中 | 加热区故障` ✅
  - `material` → `ANT-4G-001 | 4G天线 | IPEX-1代` ✅
- **`device` 主数据与演示数据前置条件一致**：`EQP-SMT-006` 状态已是「维修中」、备注「加热区故障」，符合 `开发启动指令.md` 阶段三第 3 条 ✅
- **源文件一致性**：`企业数据文件/*.xlsx` 与 `mes-upgrade-starter/data/*.xlsx` 六份文件 MD5 **逐一相同**，starter 包未截断 ✅

---

## 5. 裁决记录 / 已知问题

### 5.1 `bom` 行数口径裁决（已闭环，2026-10-10）

**裁决结论：`bom` 期望值 = 28。2 行「成品行」不计入 BOM 物料行。**

**事实依据：**

源 `data/03_BOM清单.xlsx` 两个 sheet 表头以下数据行合计恰为 **30** 行，其中含 2 行「成品行」（层级 = 0，物料编号即产品编号本身）：

| sheet | 表头以下数据行 | 其中「成品行」(层级=0) | 实际物料行(层级=1) |
|---|---|---|---|
| `JC-PLC-2001 BOM` | 第 3–20 行 = 18 | 1（第 3 行，物料编号 = `JC-PLC-2001`） | **17** |
| `JC-IoT-4G-A BOM` | 第 3–14 行 = 12 | 1（第 3 行，物料编号 = `JC-IoT-4G-A`） | **11** |
| **合计** | **30** | **2** | **28** |

**成品行必须排除，理由有二：**

1. **外键不允许。** `bom.material_code` 有外键 `fk_bom_material REFERENCES material(code)`，而 `JC-PLC-2001` / `JC-IoT-4G-A` 是产品编号，**不在 `material` 表中**（实测 `SELECT COUNT(*) FROM material WHERE code IN ('JC-PLC-2001','JC-IoT-4G-A')` 返回 **0**）。强行插入将违反外键约束。
2. **语义错误。** BOM 描述"成品由哪些物料构成"，成品不应作为自身的物料子项。

`db/seed_from_excel.py` 第 74 行 `if str(r[0]) == '0': continue` 主动跳过层级 0，**行为正确**，予以保留，不作修改。

**结论：数据库中的 28 行正确；原文档期望值 30 系把 2 行成品行误计为物料行。**

**文档口径同步（已完成，2026-10-10 同步到正式位置）：**
- [x] `db/schema.sql` 第 58 行表注释已同步为「2个产品共28行物料行，不含2行成品行」；旧版留存为 `db/schema.sql.bak`
- [x] `docs/开发启动指令.md` 阶段一第 3 步期望值已改为 `bom 28`；旧版留存为 `docs/开发启动指令.md.bak`

> 依据 `docs/api-contract.md` §10「仅 2 产品有 BOM」，与实测的 2 个产品 / 28 行一致；该契约文件未规定 bom 行数，无需修改。

### 5.2 其他待办

- [ ] `root` 口令为弱口令（6 位纯数字）。本机开发库可接受，**建议 S1 验收后更换**。
- [ ] 11 张业务表 + 1 张 AI 日志表当前为空，待阶段三 `demo_data.py` 生成近 7 天演示数据。
- [ ] 本机共存 5 个 MySQL 服务（MySQL57/80/84/841/95），仅 `MySQL841` 在运行。后续会话连接务必显式指定 `-h 127.0.0.1 -P 3306`，避免误连。
  - `MySQL84` 服务**无法启动**：其 `--defaults-file` 指向 `D:\数据库\my.ini`，而该目录整个不存在；且当前会话无管理员权限。

---

## 6. 给下个会话的提示

**S2（NestJS 后端骨架 + 连 MySQL）需要知道：**

1. **连接参数**：`host=127.0.0.1`、`port=3306`、`database=smart_mes`、`user=root`。
   本机有 5 个 MySQL 实例，**必须显式指定 host/port**，不要依赖默认值。
2. **字符集**：库与 18 张表均为 `utf8mb4` / **`utf8mb4_unicode_ci`**。
   服务端为 MySQL **8.4.9**，已移除 `mysql_native_password` 默认支持，`mysql2` 驱动请使用 `caching_sha2_password`（默认）。
3. **表结构以 `db/schema.sql` 为准**，18 张表已就位、**不要改动**。实体映射注意：
   - `product` / `device` / `material` 的主键是 **`code` 字符串**，不是 BIGINT。
   - `bom` / `process_route` 等有自增 `id`；`bom` 另有唯一键 `uk_bom(product_code, material_code)`。
   - `sys_user.password_hash` 当前为占位串 `$2b$10$PLACEHOLDER_HASH_CHANGE_ON_FIRST_LOGIN`，**不是可用密码哈希**，登录功能需另行处理（属 S2 及后续模块职责）。
4. **主数据可用性**：
   - 15 产品中**仅 2 个有 BOM**（`JC-PLC-2001` 17 行、`JC-IoT-4G-A` 11 行，合计 28）。
   - **仅 `JC-PLC-2001` 有 10 道工序明细**（`process_route` 全部 10 行都属该产品）。
   - 因此工单自动分解、MRP 算料对多数产品会命中 `30005 MISSING_PREREQUISITE`，这是**预期行为**，见 `api-contract.md` §10。
5. **先看这几个文件**：`db/schema.sql`、`docs/api-contract.md` §1/§2、本文件。
6. **环境提示**：命令必须在 **pwsh 7**（非 5.1）下执行；`<` 输入重定向在 pwsh 中不可用，需用 mysql 内置 `source` 或 `Get-Content` 管道。
