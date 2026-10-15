/**
 * B13 离线待提交队列（纯逻辑，存储经依赖注入，便于单测）。
 *
 * 铁律（任务书 §B13 要求 6~8 + S11 复审 P2 修复）：
 * - 离线时只保留**待提交输入**，并明确标记「未提交」；
 * - 恢复网络后**必须由用户确认提交** —— 本模块不含任何定时器、重试或自动补发逻辑；
 * - 只存业务输入（工单/任务/数量）+ 归属用户 ID，**不存令牌**；
 * - 持久化使用 sessionStorage（刷新可恢复，关闭标签页即清除），不写入 localStorage；
 * - **按用户隔离存储键**：`<prefix>.<userId>`；提交前必须核对 `ownerId` 与当前用户一致，
 *   杜绝「账号 A 的输入被账号 B 提交、服务端却按 B 的 JWT 记录操作员」；
 * - **区分两种状态**：
 *   - `pending`：从未发送（离线入队）→ 可由本人确认后补交；
 *   - `unknown`：已发送但结果不明（超时/响应丢失/网络中断）→ **不提供普通补交入口**，
 *     必须人工核查（如在报工列表核对）后再由用户显式移除；不得自动重试、不得自行引入持久幂等。
 */

/** 存储键前缀（最终 key = `<prefix>.<userId>`；无用户时用 `anonymous` 占位且不可提交） */
export const PENDING_REPORTS_KEY_PREFIX = 'mes.mobile.pendingReports.v2';

/** 无登录用户时的占位归属（其记录一律不可提交） */
export const ANONYMOUS_OWNER = 'anonymous';

/** 按用户派生存储键 —— 跨账号隔离的第一道防线 */
export function pendingStorageKeyFor(userId: string | null | undefined): string {
  const owner = typeof userId === 'string' && userId.length > 0 ? userId : ANONYMOUS_OWNER;
  return `${PENDING_REPORTS_KEY_PREFIX}.${owner}`;
}

/**
 * `pending`：尚未发送（离线保存，可经用户确认后补交）；
 * `unknown`：已发送但服务端结果不明（需人工核查，不可直接补交）。
 */
export type PendingReportStatus = 'pending' | 'unknown';

export interface PendingReport {
  /** 客户端生成的本地标识（仅用于列表 key 与移除） */
  id: string;
  taskId: string;
  goodQty: number;
  badQty: number;
  /** 查询时拿到的工单编号（仅展示用） */
  workOrderCode: string | null;
  /** 归属用户 ID（来自登录身份；提交前须与当前用户一致） */
  ownerId: string | null;
  createdAt: string;
  status: PendingReportStatus;
  /**
   * 最近一次「确认提交」被**明确拒绝**的原因（S11 复审 P2 #5 修复）。
   *
   * 语义：记录仍在 `pending` 状态，但上一次发送被服务端确定拒绝（400/409/403/
   * 30003/30006 等）。UI 必须据此展示拒绝原因，并提供「修改数量后重试」与「移除」
   * 两个出口——否则用户只能反复发送同一笔无效请求，形成死循环。
   */
  lastRejection?: PendingReportRejection | null;
}

/** 明确拒绝原因（契约错误码 + 服务端文案） */
export interface PendingReportRejection {
  code: number | null;
  message: string;
}

/** 简单的存储抽象（浏览器实现见 mobile 页面；测试用内存替身） */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 内存存储替身（测试与无痕降级用） */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function createPendingReport(input: {
  taskId: string;
  goodQty: number;
  badQty: number;
  ownerId: string | null;
  workOrderCode?: string | null;
  createdAt?: string;
  /** 默认 `pending`（未发送）；结果不明的提交用 `unknown` */
  status?: PendingReportStatus;
}): PendingReport {
  return {
    id: `local-${input.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: input.taskId,
    goodQty: input.goodQty,
    badQty: input.badQty,
    workOrderCode: input.workOrderCode ?? null,
    ownerId: input.ownerId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: input.status ?? 'pending',
  };
}

/** 解析存储内容；任何损坏数据都按空队列处理（不抛错、不阻塞报工） */
export function loadPendingReports(store: KeyValueStore, key: string): PendingReport[] {
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingReport).map(normalizeItem);
  } catch {
    return [];
  }
}

function isPendingReport(value: unknown): value is PendingReport {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.taskId === 'string' &&
    typeof record.goodQty === 'number' &&
    typeof record.badQty === 'number' &&
    (record.status === 'pending' || record.status === 'unknown') &&
    (record.ownerId === null || typeof record.ownerId === 'string')
  );
}

/** lastRejection 归一化：形状非法时按「无拒绝原因」处理（不丢整条记录） */
function normalizeRejection(value: unknown): PendingReportRejection | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message !== 'string' || record.message.length === 0) return null;
  const code = typeof record.code === 'number' ? record.code : null;
  return { code, message: record.message };
}

/** 读取时统一补归一化（存储内容可能来自旧版本或被手工改动） */
function normalizeItem(item: PendingReport): PendingReport {
  const rejection = normalizeRejection(item.lastRejection);
  if (rejection === null && item.lastRejection == null) return item;
  return { ...item, lastRejection: rejection };
}

export function savePendingReports(
  store: KeyValueStore,
  key: string,
  items: readonly PendingReport[],
): void {
  store.setItem(key, JSON.stringify(items));
}

/** 入队（追加到末尾，保持用户操作顺序） */
export function enqueuePendingReport(
  store: KeyValueStore,
  key: string,
  report: PendingReport,
): PendingReport[] {
  const items = loadPendingReports(store, key);
  const next = [...items, report];
  savePendingReports(store, key, next);
  return next;
}

/** 出队（按 id 移除；id 不存在时原样返回） */
export function removePendingReport(store: KeyValueStore, key: string, id: string): PendingReport[] {
  const items = loadPendingReports(store, key);
  const next = items.filter((item) => item.id !== id);
  savePendingReports(store, key, next);
  return next;
}

/**
 * 把一条记录标记为「结果未知」（已发送但服务端结果不明）。
 *
 * 用于：在线提交尝试失败（超时 / 响应丢失 / 网络中断）——请求**可能已被服务端应用**，
 * 因此不再允许当作「未发送」直接补交，必须转人工核查。
 */
export function markPendingReportUnknown(
  store: KeyValueStore,
  key: string,
  id: string,
): PendingReport[] {
  const items = loadPendingReports(store, key);
  const next = items.map((item) =>
    item.id === id ? { ...item, status: 'unknown' as const } : item,
  );
  savePendingReports(store, key, next);
  return next;
}

/**
 * 记录一次**明确拒绝**（服务端确定未写入：400/409/403/30003/30006 等）。
 *
 * 状态保持 `pending`（未提交，可修正后重试），但写入 `lastRejection` 供 UI 展示拒绝原因，
 * 并提供「修改数量」与「移除」出口（S11 复审 P2 #5：没有出口会形成重复提交死循环）。
 */
export function markPendingReportRejected(
  store: KeyValueStore,
  key: string,
  id: string,
  reason: PendingReportRejection,
): PendingReport[] {
  const items = loadPendingReports(store, key);
  const next = items.map((item) =>
    item.id === id
      ? { ...item, status: 'pending' as const, lastRejection: normalizeRejection(reason) }
      : item,
  );
  savePendingReports(store, key, next);
  return next;
}

/**
 * 修改待提交记录的数量（用户修正后重试的入口）。
 *
 * 同时清除 `lastRejection`：载荷已变，旧的拒绝原因不再适用。
 * 数量须为非负整数且和大于 0（与报工契约一致），非法输入原样返回不改存储。
 */
export function updatePendingReportQuantities(
  store: KeyValueStore,
  key: string,
  id: string,
  quantities: { goodQty: number; badQty: number },
): PendingReport[] {
  const goodQty = quantities.goodQty;
  const badQty = quantities.badQty;
  if (
    !Number.isInteger(goodQty) ||
    goodQty < 0 ||
    !Number.isInteger(badQty) ||
    badQty < 0 ||
    goodQty + badQty <= 0
  ) {
    return loadPendingReports(store, key);
  }
  const items = loadPendingReports(store, key);
  const next = items.map((item) =>
    item.id === id
      ? { ...item, goodQty, badQty, lastRejection: null }
      : item,
  );
  savePendingReports(store, key, next);
  return next;
}

/** 清空某用户的队列（主动退出登录时调用） */
export function clearPendingReports(store: KeyValueStore, key: string): void {
  store.removeItem(key);
}

/** 记录是否属于当前用户（提交前核对归属） */
export function isOwnedBy(item: PendingReport, userId: string | null | undefined): boolean {
  if (typeof userId !== 'string' || userId.length === 0) return false;
  return item.ownerId === userId;
}

/**
 * 按当前用户过滤队列（防御性）：只保留本人记录。
 * 正常按用户隔离存储键后不应出现跨账号记录；此函数兜底历史共享键数据或存储被篡改的场景。
 */
export function filterOwnedReports(
  items: readonly PendingReport[],
  userId: string | null | undefined,
): PendingReport[] {
  if (typeof userId !== 'string' || userId.length === 0) return [];
  return items.filter((item) => isOwnedBy(item, userId));
}

/** 拆分为「未提交（可补交）」与「结果未知（需人工核查）」两组 */
export function partitionPendingReports(items: readonly PendingReport[]): {
  sendable: PendingReport[];
  unknown: PendingReport[];
} {
  const sendable: PendingReport[] = [];
  const unknown: PendingReport[] = [];
  for (const item of items) {
    if (item.status === 'unknown') unknown.push(item);
    else sendable.push(item);
  }
  return { sendable, unknown };
}
