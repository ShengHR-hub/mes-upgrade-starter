import { ErrorCode } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';

import type { EntityManager } from 'typeorm';

/**
 * 产品行锁 —— BOM 写事务与订单确认的**共同互斥协议**。
 *
 * ── 背景（S10 复审 P2 第二轮：第一版修复被判定「未真正消除竞态」）──────────
 *
 * 第一版用会话级命名锁（MySQL `GET_LOCK` / `RELEASE_LOCK`）串行化两条事务。
 * 但 `RELEASE_LOCK` 写在事务回调的 `finally` 中，而 TypeORM 在**回调返回之后**
 * 才执行 `COMMIT`。于是存在如下窗口：
 *
 *   ① 订单确认事务执行 `RELEASE_LOCK`（此时**尚未提交**）；
 *   ② BOM 事务取到同一把命名锁，读不到未提交的确认结果 → 判定「无已确认业务」；
 *   ③ BOM 写入并提交；
 *   ④ 订单确认事务才提交。
 *
 * 结论：命名锁只串行化了「事务回调内部」，**没有覆盖事务提交点**，竞态依旧存在。
 *
 * ── 修复：改用**持久化产品行的行级排他锁** ─────────────────────────────
 *
 * InnoDB 行锁在**事务结束（COMMIT / ROLLBACK）时才释放**，天然覆盖提交点：
 *   - 两条事务都在各自临界区前执行 `SELECT code FROM product WHERE code = ? FOR UPDATE`；
 *   - 后到者会**阻塞到先到者提交完成**（而不是只阻塞到回调结束）；
 *   - 后到者随后读到的一定是**已提交**的确认结果 → 引用判定成立。
 *
 * ── 读一致性（REPEATABLE READ 下的关键约束，务必遵守）──────────────────
 *
 * MySQL 默认 REPEATABLE READ 的快照（read view）在事务内**第一次一致性读**时建立，
 * 而**锁定读（FOR UPDATE / FOR SHARE）不建立快照**。因此本函数必须作为
 * **事务内的第一条语句**调用：
 *   - 这样其后的引用判定（普通 `SELECT`）才是「第一次一致性读」，
 *     快照建立于「产品行锁已到手（即竞争者已提交）」之后，才能读到竞争者刚提交的订单/工单；
 *   - 若在取锁前先做普通 `SELECT`（建立过早快照），引用判定会读到陈旧数据 → 保护失效。
 * 对 `update` / `remove`：`product_code` 的定位查询必须在**事务外**完成（见 BomsService），
 * 以保证本函数是事务内第一条语句。
 *
 * ── 锁顺序（避免死锁）────────────────────────────────────────────────
 *
 * 统一约定：**产品行锁先于任何 `bom` 行锁**。
 *   - `create`：产品行 → `INSERT bom`
 *   - `update` / `remove`：产品行 → `bom` 行 `FOR UPDATE`
 *   - `confirm`：`sale_order` 行（按订单 id）→ 产品行
 * BOM 事务从不加 `sale_order` 行锁（引用判定为普通读），故与 `confirm` 不构成环；
 * BOM 各写操作都以产品行锁为第一把锁，彼此不会交叉持锁。
 */
export async function lockProductRow(manager: EntityManager, productCode: string): Promise<void> {
  const rows = (await manager.query('SELECT code FROM product WHERE code = ? FOR UPDATE', [
    productCode,
  ])) as Array<{ code: string }>;

  if (rows.length === 0) {
    // 产品不存在（create 的产品校验、或并发删除的兜底）；事务回滚，不留部分写入
    throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `产品不存在：${productCode}`);
  }
}
