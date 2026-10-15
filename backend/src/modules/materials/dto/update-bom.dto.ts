import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { MAX_INT } from '../../reports/dto/create-report.dto.js';

/**
 * `PATCH /api/v1/boms/{id}` 请求体（契约 §6.6）。
 *
 * `B level?:int,qty?:decimal-string,unit?:string/null` ——至少一个字段。
 * 资源标识（product/material）不可修改；`unit` 可显式置 null。
 *
 * ⚠️ 产品存在关联**已确认订单或工单**时，修改/删除一律 30004（契约 §6.6），
 * 由服务端引用保护强制，不依赖前端隐藏。
 */
export class UpdateBomDto {
  @IsOptional()
  @IsInt({ message: 'level 必须为整数' })
  @Min(1, { message: 'level 必须 ≥ 1' })
  @Max(MAX_INT, { message: `level 不得超过 ${MAX_INT}` })
  level?: number;

  @IsOptional()
  @IsString({ message: 'qty 必须为十进制字符串，如 "2.00"' })
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'qty 必须为十进制字符串（最多 8 位整数与 2 位小数），如 "2.00"',
  })
  qty?: string;

  /** `null` 表示清空单位；缺省（undefined）表示不修改 */
  @IsOptional()
  @IsString({ message: 'unit 必须为字符串或 null' })
  @Matches(/^[\x20-\x7e\u4e00-\u9fa5]{1,8}$/, { message: 'unit 长度必须为 1~8 个字符' })
  unit?: string | null;
}
