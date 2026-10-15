/**
 * 工单 / 任务状态机（契约 §6.3）—— 纯函数，便于单测与审查。
 */

import { WORK_ORDER_STATUS, WORK_ORDER_STATUS_VALUES } from '../orders/order-status.js';

export { WORK_ORDER_STATUS_VALUES };

export const TASK_STATUS = {
  PENDING: '待启动',
  IN_PRODUCTION: '在产',
  COMPLETED: '完工',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_STATUS_VALUES: readonly TaskStatus[] = [
  TASK_STATUS.PENDING,
  TASK_STATUS.IN_PRODUCTION,
  TASK_STATUS.COMPLETED,
];

export type WorkOrderStatusValue = (typeof WORK_ORDER_STATUS_VALUES)[number];

/** 需求已确定的主线流转与 Q2-1 已批准流转（有序对） */
const WORK_ORDER_ALLOWED_TRANSITIONS: readonly (readonly [string, string])[] = [
  // 需求确定主线
  [WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.IN_PRODUCTION],
  [WORK_ORDER_STATUS.IN_PRODUCTION, WORK_ORDER_STATUS.COMPLETED],
  // Q2-1 已批准流转（5组）：暂停、恢复、关闭
  [WORK_ORDER_STATUS.IN_PRODUCTION, WORK_ORDER_STATUS.PAUSED],
  [WORK_ORDER_STATUS.PAUSED, WORK_ORDER_STATUS.IN_PRODUCTION],
  [WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.CLOSED],
  [WORK_ORDER_STATUS.IN_PRODUCTION, WORK_ORDER_STATUS.CLOSED],
  [WORK_ORDER_STATUS.PAUSED, WORK_ORDER_STATUS.CLOSED],
];

const TASK_ALLOWED_TRANSITIONS: readonly (readonly [string, string])[] = [
  [TASK_STATUS.PENDING, TASK_STATUS.IN_PRODUCTION],
  [TASK_STATUS.IN_PRODUCTION, TASK_STATUS.COMPLETED],
];

export type TransitionDecision =
  | { kind: 'allowed' }
  | { kind: 'blocked-q2'; message: string }
  | { kind: 'invalid'; message: string };

/** 判定工单状态流转（含 Q2-1 已批准规则） */
export function resolveWorkOrderTransition(from: string, to: string): TransitionDecision {
  if (from === to) {
    return {
      kind: 'invalid',
      message: `相同状态不算流转（「${from}」）。`,
    };
  }
  if (from === WORK_ORDER_STATUS.COMPLETED || from === WORK_ORDER_STATUS.CLOSED) {
    return {
      kind: 'invalid',
      message: `工单当前为终态「${from}」，不可再流转。`,
    };
  }
  if (WORK_ORDER_ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to)) {
    return { kind: 'allowed' };
  }
  return {
    kind: 'invalid',
    message: `工单不允许从「${from}」流转到「${to}」；允许的流转包含主线及已批准的暂停/恢复/关闭。`,
  };
}

/**
 * 判定任务状态流转。
 * 顺序前置条件在 service 层判断。
 */
export function resolveTaskTransition(from: string, to: string): TransitionDecision {
  if (TASK_ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to)) {
    return { kind: 'allowed' };
  }
  return {
    kind: 'invalid',
    message: `任务不允许从「${from}」流转到「${to}」；本版仅支持主线 待启动 → 在产 → 完工。`,
  };
}

