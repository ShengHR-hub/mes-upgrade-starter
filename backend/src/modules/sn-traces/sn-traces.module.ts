import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Device } from '../../entities/device.entity.js';
import { MaterialBatch } from '../../entities/material-batch.entity.js';
import { SnTrace } from '../../entities/sn-trace.entity.js';
import { AuditModule } from '../audit/audit.module.js';

import { SnTracesController } from './sn-traces.controller.js';
import { SnTracesService } from './sn-traces.service.js';

/**
 * B6 SN 追溯模块（契约 §6.6）。
 *
 * `forFeature([SnTrace, Device, MaterialBatch])`：创建/更新快照时需要校验
 * 设备、批次的真实存在性（无 SQL 外键，服务端必须校验，契约 §6.6）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SnTrace, Device, MaterialBatch]), AuditModule],
  controllers: [SnTracesController],
  providers: [SnTracesService],
  exports: [SnTracesService],
})
export class SnTracesModule {}
