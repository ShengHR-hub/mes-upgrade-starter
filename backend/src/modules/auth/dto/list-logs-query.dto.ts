import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { IsBigintId } from '../../../common/dto/is-bigint-id.js';
import { isValidDateOnly } from '../../../common/utils/date-only.util.js';

/** AI 查询日志 kind（契约 §4 / db 注释） */
export const AI_QUERY_LOG_KINDS = ['nl_query', 'rag', 'report', 'root_cause'] as const;

function assertDate(value: unknown, field: string): void {
  if (typeof value === 'string' && !isValidDateOnly(value)) {
    throw Object.assign(new Error(`${field} 必须为真实存在的日期 YYYY-MM-DD`), { field });
  }
}

/**
 * `GET /api/v1/audit-logs` 查询参数（契约 §5.3）。
 *
 * `Q 分页、userId?:id,action?:string,startDate?:date,endDate?:date`
 *
 * 日志接口**只读**：不提供任何修改/删除入口（契约 §5.3）。
 */
export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString({ message: 'userId 必须为十进制字符串' })
  @IsBigintId({ message: 'userId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  userId?: string;

  @IsOptional()
  @IsString({ message: 'action 必须为字符串' })
  @Length(1, 64, { message: 'action 长度必须为 1~64 个字符' })
  action?: string;

  @IsOptional()
  @IsString({ message: 'startDate 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须为 YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsString({ message: 'endDate 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须为 YYYY-MM-DD' })
  endDate?: string;

  @IsOptional()
  @IsString({ message: 'page 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'page 必须为非负整数' })
  page?: string;

  @IsOptional()
  @IsString({ message: 'pageSize 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'pageSize 必须为非负整数' })
  pageSize?: string;
}

/**
 * `GET /api/v1/ai-query-logs` 查询参数（契约 §5.3）。
 *
 * `Q 分页、userId?:id,kind?:enum,status?:enum,startDate?:date,endDate?:date`
 */
export class ListAiQueryLogsQueryDto {
  @IsOptional()
  @IsString({ message: 'userId 必须为十进制字符串' })
  @IsBigintId({ message: 'userId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  userId?: string;

  @IsOptional()
  @IsIn(AI_QUERY_LOG_KINDS, {
    message: `kind 必须为 ${AI_QUERY_LOG_KINDS.join(' / ')} 之一`,
  })
  kind?: string;

  @IsOptional()
  @IsString({ message: 'status 必须为字符串' })
  @Length(1, 16, { message: 'status 长度必须为 1~16 个字符' })
  status?: string;

  @IsOptional()
  @IsString({ message: 'startDate 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须为 YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsString({ message: 'endDate 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须为 YYYY-MM-DD' })
  endDate?: string;

  @IsOptional()
  @IsString({ message: 'page 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'page 必须为非负整数' })
  page?: string;

  @IsOptional()
  @IsString({ message: 'pageSize 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'pageSize 必须为非负整数' })
  pageSize?: string;
}

/** 服务端真实日历日复核（统一口径，与列表查询共用） */
export function assertLogQueryDates(query: {
  startDate?: string;
  endDate?: string;
}): void {
  assertDate(query.startDate, 'startDate');
  assertDate(query.endDate, 'endDate');
}
