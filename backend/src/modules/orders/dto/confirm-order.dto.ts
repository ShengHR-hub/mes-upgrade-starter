import { IsIn } from 'class-validator';

import { ORDER_CONFIRMATION_EXPECTED_STATUSES } from '../order-status.js';

/**
 * `POST /api/v1/orders/{id}/confirmations` 请求体（契约 §6.2）。
 *
 * `B expectedStatus:"待确认"` —— 它是**请求控制字段，不是表列**（契约 §2.4），
 * 用于避免覆盖别人已完成的确认操作；不匹配返回 `30003`（HTTP 409）。
 *
 * ⚠️ 契约把该字段**限定为字面量 `"待确认"`**，因此这里只接受这一个值：
 * 初版误用全量订单枚举（`ORDER_STATUS_VALUES`），使 `"已完成"` 等契约外取值也能通过校验
 * —— 审查 P2 已指出「重复恢复读取例外不等于允许扩充输入集合」。
 *
 * 例外（契约 §6.2 明文）：**重复确认已确认订单属于恢复读取行为**，
 * 即使 `expectedStatus` 仍为 `待确认` 也允许，返回现有唯一工单与当前订单状态。
 * 该例外在**服务层**实现，不影响本 DTO 的取值校验。
 */
export class ConfirmOrderDto {
  @IsIn(ORDER_CONFIRMATION_EXPECTED_STATUSES, {
    message: `expectedStatus 必须为 ${ORDER_CONFIRMATION_EXPECTED_STATUSES.join(' / ')}`,
  })
  expectedStatus!: string;
}
