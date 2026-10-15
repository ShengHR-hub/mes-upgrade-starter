import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

import { IsOptionalNonNull } from '../../../common/dto/is-optional-non-null.js';
import { DATE_ONLY_PATTERN } from '../../../common/utils/date-only.util.js';

import { MAX_QTY } from './create-order.dto.js';

/**
 * `PATCH /api/v1/orders/{id}` 请求体（契约 §6.2）。
 *
 * `B productCode?:string,qty?:int,dueDate?:date`；**仅待确认可编辑**。
 *
 * 字段语义（任务书 §三「严格按契约区分 date 与 datetime、null 与未传字段」）：
 * - 契约对本接口**未开放 `null`**，因此使用 `@IsOptionalNonNull()`：
 *   只跳过「未传」（`undefined` = 保持原值），**显式传 `null` 一律 400/10001**；
 * - 三个字段至少要传一个，由服务层校验（DTO 层无法表达"至少一个"而不引入自定义校验器）。
 *
 * ⚠️ 修复记录（2026-10-10，S5 审查意见「订单 PATCH 未拒绝非法 null」）：
 * 初版误用 `@IsOptional()` —— 该装饰器对 `null` 与 `undefined` **都跳过**校验，
 * 使 `{"qty": null}` 绕过 `@IsInt` 直达 `manager.update()`，
 * 到数据库 NOT NULL 列才失败，对外表现为 500 而非 10001。
 * 注意：契约明示 `type/null` 的接口（`PATCH /work-orders/{id}`、`PATCH /tasks/{id}`）
 * 仍应使用 `@IsOptional()`，因为那里的 `null` 表示"清空"。
 */
export class UpdateOrderDto {
  @IsOptionalNonNull()
  @IsString({ message: 'productCode 必须为字符串' })
  @Length(1, 32, { message: 'productCode 长度必须为 1~32 个字符' })
  productCode?: string;

  @IsOptionalNonNull()
  @IsInt({ message: 'qty 必须为正整数' })
  @Min(1, { message: 'qty 必须为正整数' })
  @Max(MAX_QTY, { message: `qty 不得超过 ${MAX_QTY}` })
  qty?: number;

  @IsOptionalNonNull()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueDate 必须为 YYYY-MM-DD 格式' })
  dueDate?: string;
}
