import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

/** 设备状态枚举（契约 §6.7 / db/schema.sql 注释） */
export const DEVICE_STATUS_VALUES = ['运行中', '待机', '维修中', '停机'] as const;

/**
 * `GET /api/v1/devices` 查询参数（契约 §6.7）。
 *
 * `Q 分页、workshop?:string,prodLine?:string,status?:设备枚举,keyword?:string`
 */
export class ListDevicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'workshop 必须为字符串' })
  @Length(1, 32, { message: 'workshop 长度必须为 1~32 个字符' })
  workshop?: string;

  @IsOptional()
  @IsString({ message: 'prodLine 必须为字符串' })
  @Length(1, 32, { message: 'prodLine 长度必须为 1~32 个字符' })
  prodLine?: string;

  @IsOptional()
  @IsIn(DEVICE_STATUS_VALUES, {
    message: `status 必须为 ${DEVICE_STATUS_VALUES.join(' / ')} 之一`,
  })
  status?: string;

  @IsOptional()
  @IsString({ message: 'keyword 必须为字符串' })
  @Length(1, 64, { message: 'keyword 长度必须为 1~64 个字符' })
  keyword?: string;
}

/**
 * `GET /api/v1/devices/{code}/state-logs` 查询参数（契约 §6.7）。
 *
 * `Q 分页、startDate?:date,endDate?:date` —— 闭区间在服务端转半开区间（结束日 + 1 天）。
 */
export class ListDeviceStateLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'startDate 必须为日期字符串' })
  @Length(10, 10, { message: 'startDate 必须为 YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsString({ message: 'endDate 必须为日期字符串' })
  @Length(10, 10, { message: 'endDate 必须为 YYYY-MM-DD' })
  endDate?: string;
}
