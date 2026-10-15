import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * 预警列表查询 DTO —— 契约 §6.9。
 */
export class ListAlertsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须为整数' })
  @Min(1, { message: 'page 必须大于等于 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须为整数' })
  @Min(1, { message: 'pageSize 必须大于等于 1' })
  @Max(100, { message: 'pageSize 最大为 100' })
  pageSize?: number;

  @IsOptional()
  @IsString({ message: 'type 必须为字符串' })
  @MaxLength(32, { message: 'type 长度不得超过 32' })
  type?: string;

  @IsOptional()
  @IsIn(['紧急', '重要', '一般'], { message: 'level 必须为 紧急 / 重要 / 一般' })
  level?: string;

  @IsOptional()
  @IsIn(['未处理', '已确认', '已关闭'], { message: 'status 必须为 未处理 / 已确认 / 已关闭' })
  status?: string;

  @IsOptional()
  @IsString({ message: 'startDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须为 YYYY-MM-DD 格式' })
  startDate?: string;

  @IsOptional()
  @IsString({ message: 'endDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须为 YYYY-MM-DD 格式' })
  endDate?: string;
}
