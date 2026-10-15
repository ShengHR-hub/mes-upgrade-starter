import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';
import { DATE_ONLY_PATTERN } from '../../../common/utils/date-only.util.js';
import { ORDER_STATUS_VALUES } from '../order-status.js';

/**
 * `GET /api/v1/orders` 查询参数（契约 §6.2）。
 *
 * `Q 分页、status?:订单枚举,productCode?:string,keyword?:string,dueDateFrom?:date,dueDateTo?:date`
 *
 * 说明：
 * - 全局 ValidationPipe 已开启 `whitelist + forbidNonWhitelisted`，未知字段自动 10001；
 * - `status` 过滤针对**派生后的展示状态**（见 `order-status.ts`），不是数据库原值，
 *   以保证列表筛选、总数、分页与详情口径一致；
 * - `dueDateFrom/To` 此处只校验格式，真实日历日由服务层二次校验。
 */
export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUS_VALUES, {
    message: `status 必须为 ${ORDER_STATUS_VALUES.join(' / ')} 之一`,
  })
  status?: string;

  @IsOptional()
  @IsString({ message: 'productCode 必须为字符串' })
  @Length(1, 32, { message: 'productCode 长度必须为 1~32 个字符' })
  productCode?: string;

  @IsOptional()
  @IsString({ message: 'keyword 必须为字符串' })
  @Length(1, 64, { message: 'keyword 长度必须为 1~64 个字符' })
  keyword?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueDateFrom 必须为 YYYY-MM-DD 格式' })
  dueDateFrom?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueDateTo 必须为 YYYY-MM-DD 格式' })
  dueDateTo?: string;
}
