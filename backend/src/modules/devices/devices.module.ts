import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Device } from '../../entities/device.entity.js';
import { EquipmentLog } from '../../entities/equipment-log.entity.js';

import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

/**
 * B7 设备管理模块（契约 §6.7）。
 *
 * `forFeature([Device, EquipmentLog])`：equipment_log 由（当前关闭的）状态变更
 * 接口写；本版只读。Q3 批准后启用迁移时需补 AuditModule 依赖，无需改动注册。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Device, EquipmentLog])],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
