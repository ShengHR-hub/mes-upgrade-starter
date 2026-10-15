import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

/** B12：单次计算的订单数量上限（契约 §6.10 / 任务书 B12 要求 1） */
export const MAX_ORDER_IDS = 100;

/**
 * B12 MRP-lite 计算请求 DTO —— 契约 §6.10。
 *
 * 约束（任务书 B12）：
 * - `orderIds` 必须非空、去重、最多 100 个；
 * - ID 为 BIGINT 十进制字符串（契约 §2.1）——上限为 BIGINT 有符号上限的粗校验，
 *   精确校验（`isValidDecimalId`）在服务层执行；
 * - 未知字段由全局 ValidationPipe 拒绝。
 *
 * 注意：数组长度上限必须用 `@ArrayMaxSize`；class-validator 的 `@MaxLength`
 * 只对字符串生效（对数组恒为 false）。
 */
export class MaterialRequirementCalculationDto {
  @IsArray({ message: 'orderIds 必须为数组' })
  @ArrayMaxSize(MAX_ORDER_IDS, { message: `orderIds 最多 ${MAX_ORDER_IDS} 个` })
  @IsString({ each: true, message: 'orderIds 每项必须为字符串' })
  @Matches(/^\d{1,19}$/, { each: true, message: 'orderIds 每项必须为十进制数字字符串' })
  orderIds!: string[];
}
