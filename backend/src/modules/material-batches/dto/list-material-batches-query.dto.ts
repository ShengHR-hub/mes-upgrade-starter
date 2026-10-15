import { IsOptional, IsString, Length, Matches } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';
import { isValidDateOnly } from '../../../common/utils/date-only.util.js';

/**
 * `GET /api/v1/material-batches` 查询参数（契约 §6.6）。
 *
 * `Q 分页、materialCode?:string,batchNo?:string,inboundDateFrom?:date,inboundDateTo?:date`
 *
 * DTO 只做「类型 + 字面量格式」校验；真实日历日校验（拒绝 `2026-02-31` 这类
 * 正则放行的假日期）由服务端 `assertBatchQueryDates()` 按项目统一口径完成，
 * 闭区间在服务端转换为半开时间区间（结束日 + 1 天 00:00）。
 */
export class ListMaterialBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'materialCode 必须为字符串' })
  @Length(1, 32, { message: 'materialCode 长度必须为 1~32 个字符' })
  materialCode?: string;

  @IsOptional()
  @IsString({ message: 'batchNo 必须为字符串' })
  @Length(1, 64, { message: 'batchNo 长度必须为 1~64 个字符' })
  batchNo?: string;

  @IsOptional()
  @IsString({ message: 'inboundDateFrom 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inboundDateFrom 必须为 YYYY-MM-DD' })
  inboundDateFrom?: string;

  @IsOptional()
  @IsString({ message: 'inboundDateTo 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inboundDateTo 必须为 YYYY-MM-DD' })
  inboundDateTo?: string;
}

/** 服务端真实日历日校验（统一走 `isValidDateOnly`，与服务端其余日期口径一致） */
export function assertBatchQueryDates(query: ListMaterialBatchesQueryDto): void {
  if (query.inboundDateFrom !== undefined && !isValidDateOnly(query.inboundDateFrom)) {
    throw Object.assign(new Error('inboundDateFrom 必须为真实存在的日期'), {
      field: 'inboundDateFrom',
    });
  }
  if (query.inboundDateTo !== undefined && !isValidDateOnly(query.inboundDateTo)) {
    throw Object.assign(new Error('inboundDateTo 必须为真实存在的日期'), {
      field: 'inboundDateTo',
    });
  }
}
