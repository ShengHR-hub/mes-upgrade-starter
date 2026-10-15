import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

import { DATE_ONLY_PATTERN } from '../../../common/utils/date-only.util.js';

/** `sale_order.qty` 是 INT；上限取 MySQL INT 有符号最大值（任务书 §四.5「校验数据库容量边界」） */
export const MAX_QTY = 2147483647;

/**
 * `POST /api/v1/orders` 请求体（契约 §6.2）。
 *
 * `B code:string,productCode:string,qty:int,dueDate:date`
 *
 * 注意：
 * - **不声明** `createdBy` / `status` / `id`：这些字段由服务端决定；
 *   客户端一旦提交即为未知字段，被全局 ValidationPipe 拒绝（10001）；
 * - `qty` 必须是 JSON 整数（`@IsInt` 不接受字符串 `"100"`）；
 * - `dueDate` 此处只校验格式，真实日历日由服务层二次校验。
 */
export class CreateOrderDto {
  @IsString({ message: 'code 必须为字符串' })
  @Length(1, 32, { message: 'code 长度必须为 1~32 个字符' })
  code!: string;

  @IsString({ message: 'productCode 必须为字符串' })
  @Length(1, 32, { message: 'productCode 长度必须为 1~32 个字符' })
  productCode!: string;

  @IsInt({ message: 'qty 必须为正整数' })
  @Min(1, { message: 'qty 必须为正整数' })
  @Max(MAX_QTY, { message: `qty 不得超过 ${MAX_QTY}` })
  qty!: number;

  @Matches(DATE_ONLY_PATTERN, { message: 'dueDate 必须为 YYYY-MM-DD 格式' })
  dueDate!: string;
}
