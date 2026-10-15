/**
 * 订单状态口径（契约 §6.2）—— 纯函数，便于单测与跨模块复用。
 *
 * 数据库 `sale_order.status` **只存生命周期原值**：`待确认` / `已确认`。
 * `生产中` / `已完成` / `已延期` 是**查询时按固定优先级派生**的展示状态，
 * 不写回数据库（契约 §6.2「订单状态采用数据库原值…判定为…」）。
 *
 * 判定优先级（任务书 §三）：**已完成 > 已延期 > 生产中**。
 *
 * 边界（契约 §6.2 明文）：
 * - 已完成：必须**至少有一张关联工单**，且全部工单完工；**空集合不算完成**；
 * - 已延期：未完成且 `上海业务日期 > dueDate`；**当天等于 dueDate 不算延期**；
 * - 已完成即使超期也不显示已延期（优先级决定）；
 * - 「关闭」不等于完工，因此 `status='关闭'` 的工单会让订单**不**进入已完成。
 */

export const ORDER_STATUS = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  IN_PRODUCTION: '生产中',
  COMPLETED: '已完成',
  DELAYED: '已延期',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_VALUES: readonly OrderStatus[] = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.DELAYED,
];

/**
 * `POST /orders/{id}/confirmations` 的 `expectedStatus` 允许值。
 *
 * 契约 §6.2 把该字段**限定为字面量 `"待确认"`**（`B expectedStatus:"待确认"`）。
 * 初版误用了 `ORDER_STATUS_VALUES`（全部 5 个枚举值），等于把输入集合擅自扩大
 * ——「重复确认属于恢复读取」是**服务层**的例外，**不等于**可以放宽入参校验
 * （审查 P2：「确认 DTO 接受契约外 expectedStatus」）。
 */
export const ORDER_CONFIRMATION_EXPECTED_STATUSES: readonly OrderStatus[] = [ORDER_STATUS.PENDING];


/** 工单状态口径（契约 §6.3），仅本模块需要用到其中若干值 */export const WORK_ORDER_STATUS = {
  PENDING: '待启动',
  IN_PRODUCTION: '在产',
  PAUSED: '暂停',
  COMPLETED: '完工',
  CLOSED: '关闭',
} as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[keyof typeof WORK_ORDER_STATUS];

export const WORK_ORDER_STATUS_VALUES: readonly WorkOrderStatus[] = [
  WORK_ORDER_STATUS.PENDING,
  WORK_ORDER_STATUS.IN_PRODUCTION,
  WORK_ORDER_STATUS.PAUSED,
  WORK_ORDER_STATUS.COMPLETED,
  WORK_ORDER_STATUS.CLOSED,
];

export interface OrderStatusInput {
  /** 数据库原值（只应为 待确认 / 已确认） */
  baseStatus: string;
  /** 关联工单总数 */
  workOrderTotal: number;
  /** 关联工单中「未完工」的数量（status <> '完工'） */
  workOrderOpen: number;
  /** 关联工单中「在产」的数量 */
  workOrderActive: number;
  /** 交期 `YYYY-MM-DD` */
  dueDate: string;
  /** 业务当前日期 `YYYY-MM-DD`（Asia/Shanghai） */
  businessDate: string;
}

/**
 * 派生订单展示状态。
 *
 * 注意：`dueDate` / `businessDate` 必须是定长 ISO 日期串，字典序即时间序；
 * 「当天等于 dueDate」用 `<` 比较，因此**不触发**延期。
 */
export function deriveOrderStatus(input: OrderStatusInput): OrderStatus {
  const { baseStatus, workOrderTotal, workOrderOpen, workOrderActive, dueDate, businessDate } = input;

  if (workOrderTotal > 0 && workOrderOpen === 0) return ORDER_STATUS.COMPLETED;
  if (businessDate > dueDate) return ORDER_STATUS.DELAYED;
  if (workOrderActive > 0) return ORDER_STATUS.IN_PRODUCTION;

  // 其余按契约保持 待确认 / 已确认（数据库中若残留 生产中/已完成/已延期，一律归一到这两个原值）
  return baseStatus === ORDER_STATUS.PENDING ? ORDER_STATUS.PENDING : ORDER_STATUS.CONFIRMED;
}

/**
 * 生成列表查询中使用的派生状态 SQL 片段（与 `deriveOrderStatus` 逐条对应）。
 *
 * 为什么放到 SQL：任务书 §三 明确「列表筛选、总数、分页和详情必须使用一致状态口径；
 * **禁止先分页再计算状态导致筛选漏单**」。派生状态必须在过滤/计数/分页之前确定。
 *
 * `todayLiteral` 必须是服务端生成的 `YYYY-MM-DD`（已由 `isValidDateOnly` 校验），
 * 不是用户输入，因此可直接内联；其余条件仍全部走参数化。
 */
export function buildDerivedOrderStatusSql(todayLiteral: string): string {
  return [
    'CASE',
    '  WHEN (SELECT COUNT(*) FROM work_order w WHERE w.sale_order_id = o.id) > 0',
    "   AND (SELECT COUNT(*) FROM work_order w WHERE w.sale_order_id = o.id AND w.status <> '完工') = 0",
    `    THEN '${ORDER_STATUS.COMPLETED}'`,
    `  WHEN o.due_date < '${todayLiteral}' THEN '${ORDER_STATUS.DELAYED}'`,
    "  WHEN (SELECT COUNT(*) FROM work_order w WHERE w.sale_order_id = o.id AND w.status = '在产') > 0",
    `    THEN '${ORDER_STATUS.IN_PRODUCTION}'`,
    `  ELSE IF(o.status = '${ORDER_STATUS.PENDING}', '${ORDER_STATUS.PENDING}', '${ORDER_STATUS.CONFIRMED}')`,
    'END',
  ].join('\n');
}
