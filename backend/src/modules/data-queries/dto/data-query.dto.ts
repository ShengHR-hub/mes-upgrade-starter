import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { IsOptionalNonNull } from '../../../common/dto/is-optional-non-null.js';

/**
 * F3 智能问数请求 DTO —— 契约 §7.1。
 *
 * - `question` 为用户自然语言问题（1～2000 字符，契约 §2.1）；
 * - `startDate`/`endDate`/`prodLine` 为**可选显式参数**，用于精确约定查询范围；
 *   契约**未开放 null**（P2 修复：`@IsOptional()` 会跳过 null，导致服务层
 *   `null.trim()` 500），因此统一使用 `IsOptionalNonNull`；
 * - 显式参数与自然语言解析出的范围冲突时，服务层返回 10001 要求重述（契约 §7.1）。
 */
export class DataQueryDto {
  @IsString({ message: 'question 必须为字符串' })
  @IsNotEmpty({ message: 'question 不能为空' })
  @MaxLength(2000, { message: 'question 长度不得超过 2000' })
  question!: string;

  @IsOptionalNonNull()
  @IsString({ message: 'startDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须为 YYYY-MM-DD 格式' })
  startDate?: string;

  @IsOptionalNonNull()
  @IsString({ message: 'endDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须为 YYYY-MM-DD 格式' })
  endDate?: string;

  @IsOptionalNonNull()
  @IsString({ message: 'prodLine 必须为字符串' })
  @MaxLength(32, { message: 'prodLine 长度不得超过 32' })
  prodLine?: string;
}
