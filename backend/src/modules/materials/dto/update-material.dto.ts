import { IsInt, Max, Min } from 'class-validator';

import { MAX_INT } from '../../reports/dto/create-report.dto.js';

/**
 * `PATCH /api/v1/materials/{code}` 请求体（契约 §6.6）。
 *
 * `B safetyStock:int`（≥0）——本接口**只能**改安全库存：
 * - 物料主数据其余字段不在本版契约写入范围内；
 * - 安全库存只是记录值，**没有可用库存流水，不触发自动预警**（契约 §10.1）。
 */
export class UpdateMaterialDto {
  @IsInt({ message: 'safetyStock 必须为整数' })
  @Min(0, { message: 'safetyStock 必须大于或等于 0' })
  @Max(MAX_INT, { message: `safetyStock 不得超过 ${MAX_INT}` })
  safetyStock!: number;
}
