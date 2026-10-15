import { IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { IsBigintId } from '../../../common/dto/is-bigint-id.js';

/** MySQL INT SIGNED 上限 (2^31 - 1) */
export const MAX_INT = 2147483647;

export class CreateReportDto {
  @IsString({ message: 'taskId 必须为字符串' })
  @IsBigintId({ message: 'taskId 必须为正整数且不超过 BIGINT 上限' })
  taskId: string;

  @IsInt({ message: 'goodQty 必须为整数' })
  @Min(0, { message: 'goodQty 必须大于或等于 0' })
  @Max(MAX_INT, { message: `goodQty 不得超过 ${MAX_INT}` })
  @Type(() => Number)
  goodQty: number;

  @IsInt({ message: 'badQty 必须为整数' })
  @Min(0, { message: 'badQty 必须大于或等于 0' })
  @Max(MAX_INT, { message: `badQty 不得超过 ${MAX_INT}` })
  @Type(() => Number)
  badQty: number;
}
