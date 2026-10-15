import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { MAX_INT } from '../../reports/dto/create-report.dto.js';

/** MySQL INT SIGNED 上限 (2^31 - 1)，批次入库数量同样受该列容量约束 */
export const BATCH_QTY_MAX = MAX_INT;

/**
 * `POST /api/v1/material-batches` 请求体（契约 §6.6）。
 *
 * `B batchNo:string,materialCode:string,qty:int,inboundAt:date,supplier?:string`
 *
 * - `batchNo` 全局唯一（SQL 有唯一约束；服务端先查重再插入，并把 1062 转 30002）；
 * - `qty` 仅表示**入库数量**（契约 §6.6），不得解释为可用库存；
 * - `inboundAt` 必须是真实存在的日历日（服务端二次校验）。
 */
export class CreateMaterialBatchDto {
  @IsString({ message: 'batchNo 必须为字符串' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,64}$/, { message: 'batchNo 长度必须为 1~64 个字符' })
  batchNo!: string;

  @IsString({ message: 'materialCode 必须为字符串' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,32}$/, {
    message: 'materialCode 长度必须为 1~32 个字符',
  })
  materialCode!: string;

  @IsInt({ message: 'qty 必须为整数' })
  @Min(1, { message: 'qty 必须为正整数（入库数量）' })
  @Max(BATCH_QTY_MAX, { message: `qty 不得超过 ${BATCH_QTY_MAX}` })
  @Type(() => Number)
  qty!: number;

  @IsString({ message: 'inboundAt 必须为日期字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inboundAt 必须为 YYYY-MM-DD' })
  inboundAt!: string;

  @IsOptional()
  @IsString({ message: 'supplier 必须为字符串' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,64}$/, { message: 'supplier 长度必须为 1~64 个字符' })
  supplier?: string;
}
