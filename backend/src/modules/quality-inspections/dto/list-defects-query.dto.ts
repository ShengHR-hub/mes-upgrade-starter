import { IsOptional, Matches, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';
import { IsBigintId } from '../../../common/dto/is-bigint-id.js';
import { DATE_ONLY_PATTERN } from '../../../common/utils/date-only.util.js';

export class ListDefectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsBigintId({ message: 'qcRecordId 必须为正整数且不超过 BIGINT 上限' })
  qcRecordId?: string;

  @IsOptional()
  @IsBigintId({ message: 'workOrderId 必须为正整数且不超过 BIGINT 上限' })
  workOrderId?: string;

  @IsOptional()
  @IsString({ message: 'defectType 必须为字符串' })
  @Length(1, 32, { message: 'defectType 长度必须为 1~32 个字符' })
  defectType?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'startDate 必须为 YYYY-MM-DD 格式' })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'endDate 必须为 YYYY-MM-DD 格式' })
  endDate?: string;
}
