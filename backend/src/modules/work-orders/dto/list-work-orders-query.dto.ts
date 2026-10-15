import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { IsBigintId } from '../../../common/dto/is-bigint-id.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

import { WORK_ORDER_STATUS_VALUES } from '../work-order-state-machine.js';

/**
 * `GET /api/v1/work-orders` 查询参数（契约 §6.3）。
 *
 * `Q 分页、saleOrderId?:id,productCode?:string,status?:工单枚举,keyword?:string`
 *
 * 工单状态是数据库原值，无派生，因此筛选与展示天然同口径。
 *
 * ⚠️ `saleOrderId` 与路径参数使用**同一套 BIGINT 校验**（形态 + 容量上限），
 * 避免"路径校验容量、查询只校验位数"的不一致（审查 P2）。
 */
export class ListWorkOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'saleOrderId 必须为十进制字符串' })
  @IsBigintId({ message: 'saleOrderId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  saleOrderId?: string;

  @IsOptional()
  @IsString({ message: 'productCode 必须为字符串' })
  @Length(1, 32, { message: 'productCode 长度必须为 1~32 个字符' })
  productCode?: string;

  @IsOptional()
  @IsIn(WORK_ORDER_STATUS_VALUES, {
    message: `status 必须为 ${WORK_ORDER_STATUS_VALUES.join(' / ')} 之一`,
  })
  status?: string;

  @IsOptional()
  @IsString({ message: 'keyword 必须为字符串' })
  @Length(1, 64, { message: 'keyword 长度必须为 1~64 个字符' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: 'prodLine 必须为字符串' })
  @Length(1, 32, { message: 'prodLine 长度必须为 1~32 个字符' })
  prodLine?: string;

  @IsOptional()
  @IsString({ message: 'workshop 必须为字符串' })
  @Length(1, 32, { message: 'workshop 长度必须为 1~32 个字符' })
  workshop?: string;
}
