import { IsOptional, IsString, Matches } from 'class-validator';

import { DATE_ONLY_PATTERN } from '../../../common/utils/date-only.util.js';

/**
 * `PATCH /api/v1/work-orders/{id}` 请求体（契约 §6.3）。
 *
 * `B planStart?:date/null,planEnd?:date/null`；**仅待启动可编辑**，起日 ≤ 止日。
 *
 * 字段语义（任务书 §三「严格按契约区分 date 与 datetime、null 与未传字段」）：
 * - 契约对本接口**明确允许 `null`**（`date/null`），因此 `null` = 清空计划；
 * - 「未传」= 属性值 `undefined` = 保持原值；
 * - 计划列是 **DATE**（`work_order.plan_start / plan_end`），不接受时间部分；
 *   任务级的 DATETIME 计划由 `PATCH /tasks/{id}` 维护，两者不可互相替代（契约 §6.8）。
 */
export class UpdateWorkOrderDto {
  @IsOptional()
  @IsString({ message: 'planStart 必须为 YYYY-MM-DD 字符串或 null' })
  @Matches(DATE_ONLY_PATTERN, { message: 'planStart 必须为 YYYY-MM-DD 格式' })
  planStart?: string | null;

  @IsOptional()
  @IsString({ message: 'planEnd 必须为 YYYY-MM-DD 字符串或 null' })
  @Matches(DATE_ONLY_PATTERN, { message: 'planEnd 必须为 YYYY-MM-DD 格式' })
  planEnd?: string | null;
}
