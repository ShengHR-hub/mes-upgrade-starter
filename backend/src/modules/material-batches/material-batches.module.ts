import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MaterialBatch } from '../../entities/material-batch.entity.js';
import { Material } from '../../entities/material.entity.js';
import { SnTrace } from '../../entities/sn-trace.entity.js';
import { AuditModule } from '../audit/audit.module.js';

import { MaterialBatchesController } from './material-batches.controller.js';
import { MaterialBatchesService } from './material-batches.service.js';

/**
 * B5 物料批次模块（契约 §6.6）。
 *
 * `forFeature([MaterialBatch, Material, SnTrace])`：
 * - `MaterialBatch` / `Material` —— 批次入库与物料存在性校验（事务内必须已注册）；
 * - `SnTrace` —— 批次反查（`GET /material-batches/{id}/sn-traces`）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([MaterialBatch, Material, SnTrace]), AuditModule],
  controllers: [MaterialBatchesController],
  providers: [MaterialBatchesService],
  exports: [MaterialBatchesService],
})
export class MaterialBatchesModule {}
