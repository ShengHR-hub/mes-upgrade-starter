import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 经营驾驶舱设备指标查询 DTO —— 契约 §6.8。
 */
export class DeviceMetricsQueryDto {
  @IsOptional()
  @IsString({ message: 'workshop 必须为字符串' })
  @MaxLength(32, { message: 'workshop 长度不得超过 32' })
  workshop?: string;

  @IsOptional()
  @IsString({ message: 'prodLine 必须为字符串' })
  @MaxLength(32, { message: 'prodLine 长度不得超过 32' })
  prodLine?: string;
}
