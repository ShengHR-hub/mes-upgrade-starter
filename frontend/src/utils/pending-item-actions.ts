/**
 * 待提交记录的可用操作集（纯函数，S11 复审 P2 #5 修复）。
 *
 * 存在的理由：明确拒绝的待提交记录若只有「确认提交」一个入口，用户无法修正也无法移除，
 * 只能反复发送同一笔无效请求（死循环）。本函数把「每种状态下用户能做什么」收敛为
 * 可单测的决策表，视图只负责渲染。
 *
 * 规则：
 * - `pending` 且属于当前用户 → 可提交、可编辑数量、可移除；（`lastRejection` 非空时
 *   界面额外展示拒绝原因并默认展开编辑器，但操作集不变）；
 * - `unknown`（已发送结果不明）→ 仅可「人工核查后移除」；**不可提交、不可编辑**；
 * - 不属于当前用户 → 任何操作都不可用（移交给调用方按跨账号残留处理）。
 */

import type { PendingReport } from './offline-queue';

export interface PendingItemActions {
  canSubmit: boolean;
  canEdit: boolean;
  canRemove: boolean;
  /** unknown 状态的「人工核查后移除」 */
  canDiscard: boolean;
}

const NO_ACTIONS: PendingItemActions = {
  canSubmit: false,
  canEdit: false,
  canRemove: false,
  canDiscard: false,
};

export function pendingItemActions(
  item: PendingReport,
  currentUserId: string | null | undefined,
): PendingItemActions {
  if (typeof currentUserId !== 'string' || currentUserId.length === 0) return NO_ACTIONS;
  if (item.ownerId !== currentUserId) return NO_ACTIONS;

  if (item.status === 'unknown') {
    // 结果不明：不能直接补交、不能改（改了也无法证明对应哪次发送），只能人工核查后移除
    return { canSubmit: false, canEdit: false, canRemove: false, canDiscard: true };
  }

  // pending（含被明确拒绝、带 lastRejection 的记录）：提交 / 编辑 / 移除全部开放
  return { canSubmit: true, canEdit: true, canRemove: true, canDiscard: false };
}

/** 是否需要展示「最近一次被拒绝」横幅（pending + 有拒绝原因） */
export function hasRejectionNotice(item: PendingReport): boolean {
  return item.status === 'pending' && item.lastRejection != null;
}
