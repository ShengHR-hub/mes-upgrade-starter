import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { IsBigintId } from '../../../common/dto/is-bigint-id.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

/** 检验结果枚举（与 §6.5 一致：OK/NG） */
export const QC_RESULT_VALUES = ['OK', 'NG'] as const;

/**
 * `GET /api/v1/sn-traces` 查询参数（契约 §6.6）。
 *
 * `Q 分页、sn?:string,workOrderId?:id,batchId?:id`
 *
 * - `sn` 是**精确匹配**（唯一键），不用模糊结果冒充唯一追溯；
 * - `workOrderId` / `batchId` 走同一套 BIGINT 校验（形态 + 容量上限）。
 */
export class ListSnTracesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'sn 必须为字符串' })
  @Length(1, 64, { message: 'sn 长度必须为 1~64 个字符' })
  sn?: string;

  @IsOptional()
  @IsString({ message: 'workOrderId 必须为十进制字符串' })
  @IsBigintId({ message: 'workOrderId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  workOrderId?: string;

  @IsOptional()
  @IsString({ message: 'batchId 必须为十进制字符串' })
  @IsBigintId({ message: 'batchId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  batchId?: string;
}

/**
 * `POST /api/v1/sn-traces` 请求体（契约 §6.6）。
 *
 * `B sn:string,workOrderId:id,taskId?:id,deviceCode?:string,batchId?:id,qcResult?:检验枚举`
 *
 * - `productCode` 由服务端从工单读取、`operatorId` 取可信身份，**不接受客户端指定**；
 * - `taskId` 必须属于该工单（10002）；`deviceCode` / `batchId` 必须存在；
 * - `qcResult` 只是快照字段，不证明与某张 qc_record 逐件绑定；
 * - `sn` 唯一，重复创建返回 30002。
 */
export class CreateSnTraceDto {
  @IsString({ message: 'sn 必须为字符串' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,64}$/, { message: 'sn 长度必须为 1~64 个字符' })
  sn!: string;

  @IsString({ message: 'workOrderId 必须为十进制字符串' })
  @IsBigintId({ message: 'workOrderId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  workOrderId!: string;

  @IsOptional()
  @IsString({ message: 'taskId 必须为十进制字符串' })
  @IsBigintId({ message: 'taskId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  taskId?: string;

  @IsOptional()
  @IsString({ message: 'deviceCode 必须为字符串' })
  @Length(1, 32, { message: 'deviceCode 长度必须为 1~32 个字符' })
  deviceCode?: string;

  @IsOptional()
  @IsString({ message: 'batchId 必须为十进制字符串' })
  @IsBigintId({ message: 'batchId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  batchId?: string;

  @IsOptional()
  @IsIn(QC_RESULT_VALUES, { message: 'qcResult 必须为 OK / NG 之一' })
  qcResult?: string;
}

/**
 * `POST /api/v1/sn-traces/{sn}/exports` 请求体（契约 §6.6；Q7）。
 *
 * 本版仅支持 `format:"json"`：PDF 追溯格式 / IATF 16949 合规验收见 Q7，未批准前
 * 不得宣称或伪造其他格式。
 */
export class ExportSnTraceDto {
  @IsIn(['json'], { message: '本版仅支持 format="json"' })
  format!: string;
}

/**
 * `PATCH /api/v1/sn-traces/{sn}` 请求体（契约 §6.6）。
 *
 * 仅当前快照字段；**不修改 producedAt**，不伪造过去事件；至少一个字段。
 */
export class UpdateSnTraceDto {
  @IsOptional()
  @IsString({ message: 'taskId 必须为十进制字符串' })
  @IsBigintId({ message: 'taskId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  taskId?: string;

  @IsOptional()
  @IsString({ message: 'deviceCode 必须为字符串' })
  @Length(1, 32, { message: 'deviceCode 长度必须为 1~32 个字符' })
  deviceCode?: string;

  @IsOptional()
  @IsString({ message: 'batchId 必须为十进制字符串' })
  @IsBigintId({ message: 'batchId 必须为正整数（十进制字符串）且不超过 BIGINT 上限' })
  batchId?: string;

  @IsOptional()
  @IsIn(QC_RESULT_VALUES, { message: 'qcResult 必须为 OK / NG 之一' })
  qcResult?: string;
}
