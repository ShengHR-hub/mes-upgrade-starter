import { IsString, IsInt, Min, Max, Length, IsOptional, ValidateNested, IsIn, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { IsBigintId } from '../../../common/dto/is-bigint-id.js';

export const MAX_INT = 2147483647;

export class DefectItemDto {
  @IsString({ message: 'defectType 必须为字符串' })
  @Length(1, 32, { message: 'defectType 长度必须为 1~32 个字符' })
  defectType: string;

  @IsInt({ message: 'qty 必须为整数' })
  @Min(1, { message: 'qty 必须大于或等于 1' })
  @Max(MAX_INT, { message: `qty 不得超过 ${MAX_INT}` })
  @Type(() => Number)
  qty: number;

  @IsOptional()
  @IsString({ message: 'description 必须为字符串' })
  @Length(1, 256, { message: 'description 长度不得超过 256 个字符' })
  description?: string;
}

export class CreateQualityInspectionDto {
  @IsString({ message: 'workOrderId 必须为字符串' })
  @IsBigintId({ message: 'workOrderId 必须为正整数且不超过 BIGINT 上限' })
  workOrderId: string;

  @IsOptional()
  @IsString({ message: 'taskId 必须为字符串' })
  @IsBigintId({ message: 'taskId 必须为正整数且不超过 BIGINT 上限' })
  taskId?: string;

  @IsIn(['OK', 'NG'], { message: 'result 必须为 OK 或 NG' })
  result: 'OK' | 'NG';

  @IsInt({ message: 'checkQty 必须为整数' })
  @Min(1, { message: 'checkQty 必须大于或等于 1' })
  @Max(MAX_INT, { message: `checkQty 不得超过 ${MAX_INT}` })
  @Type(() => Number)
  checkQty: number;

  @IsInt({ message: 'ngQty 必须为整数' })
  @Min(0, { message: 'ngQty 必须大于或等于 0' })
  @Max(MAX_INT, { message: `ngQty 不得超过 ${MAX_INT}` })
  @Type(() => Number)
  ngQty: number;

  @IsOptional()
  @IsString({ message: 'remark 必须为字符串' })
  @Length(1, 256, { message: 'remark 长度不得超过 256 个字符' })
  remark?: string;

  @IsOptional()
  @IsArray({ message: 'defects 必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => DefectItemDto)
  defects?: DefectItemDto[];
}
