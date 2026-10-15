import { IsOptional, IsString, Length, Matches } from 'class-validator';

import { IsBigintId } from '../../../common/dto/is-bigint-id.js';
import { RFC3339_PATTERN } from '../../../common/utils/rfc3339.util.js';

/**
 * `PATCH /api/v1/tasks/{id}` 请求体（契约 §6.3）。
 *
 * `B deviceCode?:string/null,operatorId?:id/null,prodLine?:string/null,planStart?:datetime/null,planEnd?:datetime/null`
 *
 * ⚠️ **Q2 边界（重要）**：契约原文「人工分配规则待 Q2」。
 * 本版只做**契约已明文冻结**的校验：
 * - 人工分配设备须**真实设备存在**（契约 §6.3）；
 * - 操作员须为**真实账号**（契约 §10.2：`work_task` 的设备/用户无 SQL 外键，服务端必须校验）；
 * - 任务须存在；DATETIME 计划须为合法 RFC 3339 且起 ≤ 止。
 * **未施加**任何未获批准的分配条件（如"设备须与任务同产线"、"设备须运行中"），
 * 该部分待 Q2 确认后回改。
 *
 * 字段语义：
 * - `null` = 清空该字段（契约明示 `…/null`）；
 * - 未传（`undefined`）= 保持原值。
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString({ message: 'deviceCode 必须为字符串或 null' })
  @Length(1, 32, { message: 'deviceCode 长度必须为 1~32 个字符' })
  deviceCode?: string | null;

  @IsOptional()
  @IsString({ message: 'operatorId 必须为十进制字符串或 null' })
  @IsBigintId({ message: 'operatorId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  operatorId?: string | null;

  @IsOptional()
  @IsString({ message: 'prodLine 必须为字符串或 null' })
  @Length(1, 32, { message: 'prodLine 长度必须为 1~32 个字符' })
  prodLine?: string | null;

  @IsOptional()
  @IsString({ message: 'planStart 必须为 RFC 3339 字符串或 null' })
  @Matches(RFC3339_PATTERN, { message: 'planStart 必须为 RFC 3339 格式（含时区偏移）' })
  planStart?: string | null;

  @IsOptional()
  @IsString({ message: 'planEnd 必须为 RFC 3339 字符串或 null' })
  @Matches(RFC3339_PATTERN, { message: 'planEnd 必须为 RFC 3339 格式（含时区偏移）' })
  planEnd?: string | null;
}
