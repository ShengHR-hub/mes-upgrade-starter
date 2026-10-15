import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * 经营驾驶舱交付指标查询 DTO —— 契约 §6.8。
 */
export class DeliveryMetricsQueryDto {
  @IsNotEmpty({ message: 'startDate 不能为空' })
  @IsString({ message: 'startDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须为 YYYY-MM-DD 格式' })
  startDate!: string;

  @IsNotEmpty({ message: 'endDate 不能为空' })
  @IsString({ message: 'endDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须为 YYYY-MM-DD 格式' })
  endDate!: string;

  @IsOptional()
  @IsString({ message: 'productCode 必须为字符串' })
  @MaxLength(32, { message: 'productCode 长度不得超过 32' })
  productCode?: string;
}
