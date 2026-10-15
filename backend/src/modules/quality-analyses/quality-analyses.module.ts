import { Module } from '@nestjs/common';

import { QualityAnalysesController } from './quality-analyses.controller.js';
import { QualityAnalysesService } from './quality-analyses.service.js';

/**
 * B11 SPC 质量分析模块（契约 §6.5）。
 *
 * 只读模块：直接使用 DataSource 受控查询（不注册实体 Repository，
 * 不新增表、不改 18 张表结构）。数据源：`defect` / `qc_record` / `report` / `work_task`。
 */
@Module({
  controllers: [QualityAnalysesController],
  providers: [QualityAnalysesService],
  exports: [QualityAnalysesService],
})
export class QualityAnalysesModule {}
