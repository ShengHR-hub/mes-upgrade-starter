import { IsIn } from 'class-validator';

import { TASK_STATUS_VALUES, WORK_ORDER_STATUS_VALUES } from '../work-order-state-machine.js';

/**
 * `POST /api/v1/work-orders/{id}/state-transitions` 请求体（契约 §6.3）。
 *
 * `B expectedStatus:工单枚举,targetStatus:工单枚举`
 *
 * `expectedStatus` 是**请求控制字段，不是表列**（契约 §2.4）：不匹配返回 409 / 30003，
 * 避免覆盖别人已完成的操作。
 *
 * 本 DTO 只做枚举取值校验；**流转合法性**由 `work-order-state-machine.ts` 判定，
 * 涉及暂停/恢复/关闭时返回 30006（Q2 未决，不启用）。
 */
export class WorkOrderStateTransitionDto {
  @IsIn(WORK_ORDER_STATUS_VALUES, {
    message: `expectedStatus 必须为 ${WORK_ORDER_STATUS_VALUES.join(' / ')} 之一`,
  })
  expectedStatus!: string;

  @IsIn(WORK_ORDER_STATUS_VALUES, {
    message: `targetStatus 必须为 ${WORK_ORDER_STATUS_VALUES.join(' / ')} 之一`,
  })
  targetStatus!: string;
}

/**
 * `POST /api/v1/tasks/{id}/state-transitions` 请求体（契约 §6.3）。
 *
 * `B expectedStatus:任务枚举,targetStatus:任务枚举`；任务枚举仅 `待启动/在产/完工`。
 */
export class TaskStateTransitionDto {
  @IsIn(TASK_STATUS_VALUES, {
    message: `expectedStatus 必须为 ${TASK_STATUS_VALUES.join(' / ')} 之一`,
  })
  expectedStatus!: string;

  @IsIn(TASK_STATUS_VALUES, {
    message: `targetStatus 必须为 ${TASK_STATUS_VALUES.join(' / ')} 之一`,
  })
  targetStatus!: string;
}
