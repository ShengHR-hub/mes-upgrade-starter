import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { MAX_INT } from '../../reports/dto/create-report.dto.js';

/**
 * `POST /api/v1/products/{code}/boms` 请求体（契约 §6.6）。
 *
 * `B materialCode:string,level:int,qty:decimal-string,unit?:string`
 *
 * - `qty` 为**精确十进制字符串**（`^\d{1,8}(\.\d{1,2})?$`，>0），不接受 number 与科学计数法；
 * - `level` ≥ 1；`level` 不是父子关联，本版不推断多层 BOM 树；
 * - `materialCode` 必须指向已存在的物料（10002）；同产品同物料重复 → 30002。
 */
export class CreateBomDto {
  @IsString({ message: 'materialCode 必须为字符串' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,32}$/, {
    message: 'materialCode 长度必须为 1~32 个字符',
  })
  materialCode!: string;

  @IsInt({ message: 'level 必须为整数' })
  @Min(1, { message: 'level 必须 ≥ 1' })
  @Max(MAX_INT, { message: `level 不得超过 ${MAX_INT}` })
  level!: number;

  @IsString({ message: 'qty 必须为十进制字符串，如 "2.00"' })
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'qty 必须为十进制字符串（最多 8 位整数与 2 位小数），如 "2.00"',
  })
  qty!: string;

  @IsOptional()
  @IsString({ message: 'unit 必须为字符串' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,8}$/, { message: 'unit 长度必须为 1~8 个字符' })
  unit?: string;
}
