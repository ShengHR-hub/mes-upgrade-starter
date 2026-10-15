import { Module } from '@nestjs/common';

import { MaterialRequirementsController } from './material-requirements.controller.js';
import { MaterialRequirementsService } from './material-requirements.service.js';

/**
 * B12 MRP-lite 模块（契约 §6.10，受限）。
 *
 * 只读模块：直接使用 DataSource 受控查询（`sale_order` / `bom` / `material_batch`），
 * 不新增表、不改表结构、不引入采购写入入口。
 */
@Module({
  controllers: [MaterialRequirementsController],
  providers: [MaterialRequirementsService],
  exports: [MaterialRequirementsService],
})
export class MaterialRequirementsModule {}
