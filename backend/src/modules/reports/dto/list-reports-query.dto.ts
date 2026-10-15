import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';
import { IsBigintId } from '../../../common/dto/is-bigint-id.js';
import { DATE_ONLY_PATTERN } from '../../../common/utils/date-only.util.js';

export class ListReportsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsBigintId({ message: 'taskId 必须为正整数且不超过 BIGINT 上限' })
  taskId?: string;

  @IsOptional()
  @IsBigintId({ message: 'workOrderId 必须为正整数且不超过 BIGINT 上限' })
  workOrderId?: string;

  @IsOptional()
  @IsBigintId({ message: 'userId 必须为正整数且不超过 BIGINT 上限' })
  userId?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'startDate 必须为 YYYY-MM-DD 格式' })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'endDate 必须为 YYYY-MM-DD 格式' })
  endDate?: string;

  @IsOptional()
  @IsString({ message: 'prodLine 必须为字符串' })
  @Length(1, 32, { message: 'prodLine 长度必须为 1~32 个字符' })
  prodLine?: string;

  @IsOptional()
  @IsString({ message: 'workshop 必须为字符串' })
  @Length(1, 32, { message: 'workshop 长度必须为 1~32 个字符' })
  workshop?: string;

  @IsOptional()
  @IsString({ message: 'productCode 必须为字符串' })
  @Length(1, 32, { message: 'productCode 长度必须为 1~32 个字符' })
  productCode?: string;
}

