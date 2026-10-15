/**
 * B2 工单与工序任务服务（契约 §6.3）。
 *
 * 全部经统一客户端发起。权限（契约 §5.2）：
 * - 读工单 / tasks / task 详情 → 三角色；
 * - 改工单计划、状态流转、任务计划 → 仅 admin / manager。
 */

import { httpGet, httpPatch, httpPost } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type {
  StateTransitionPayload,
  Task,
  TaskListQuery,
  TaskTransitionResult,
  UpdateTaskPayload,
  UpdateWorkOrderPayload,
  WorkOrder,
  WorkOrderListQuery,
  WorkOrderTransitionResult,
} from '@/types/work-order'

export const workOrdersService = {
  list(query: WorkOrderListQuery, signal?: AbortSignal): Promise<PageResult<WorkOrder>> {
    return httpGet<PageResult<WorkOrder>>('/work-orders', compactParams({ ...query }), { signal })
  },

  detail(id: string, signal?: AbortSignal): Promise<WorkOrder> {
    return httpGet<WorkOrder>(`/work-orders/${encodeURIComponent(id)}`, undefined, { signal })
  },

  updatePlan(id: string, payload: UpdateWorkOrderPayload, signal?: AbortSignal): Promise<WorkOrder> {
    return httpPatch<WorkOrder>(`/work-orders/${encodeURIComponent(id)}`, payload, { signal })
  },

  tasks(id: string, query: TaskListQuery, signal?: AbortSignal): Promise<PageResult<Task>> {
    return httpGet<PageResult<Task>>(
      `/work-orders/${encodeURIComponent(id)}/tasks`,
      compactParams({ ...query }),
      { signal },
    )
  },

  taskDetail(id: string, signal?: AbortSignal): Promise<Task> {
    return httpGet<Task>(`/tasks/${encodeURIComponent(id)}`, undefined, { signal })
  },

  /**
   * ⚠️ **Q2 未获批准前，本方法没有任何界面入口，且后端一律返回 `30006`。**
   *
   * 保留方法是为了完整映射契约 §6.3 已冻结的接口形状（Q2 批准后直接接线即可）；
   * 用户裁决（2026-10-10）要求"前端不提供可执行按钮"——
   * 因此 `views/work-orders/WorkOrdersView.vue` **不调用**本方法。
   */
  updateTask(id: string, payload: UpdateTaskPayload, signal?: AbortSignal): Promise<Task> {
    return httpPatch<Task>(`/tasks/${encodeURIComponent(id)}`, payload, { signal })
  },

  transitionWorkOrder(
    id: string,
    payload: StateTransitionPayload,
    signal?: AbortSignal,
  ): Promise<WorkOrderTransitionResult> {
    return httpPost<WorkOrderTransitionResult>(
      `/work-orders/${encodeURIComponent(id)}/state-transitions`,
      payload,
      { signal },
    )
  },

  /**
   * ⚠️ **Q2 未获批准前，本方法没有任何界面入口，且后端一律返回 `30006`。**
   *
   * 同上：保留方法只为映射契约，界面不提供可执行按钮。
   */
  transitionTask(
    id: string,
    payload: StateTransitionPayload,
    signal?: AbortSignal,
  ): Promise<TaskTransitionResult> {
    return httpPost<TaskTransitionResult>(
      `/tasks/${encodeURIComponent(id)}/state-transitions`,
      payload,
      { signal },
    )
  },
}
