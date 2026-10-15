import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Device } from '../../entities/device.entity.js';
import { SysUser } from '../../entities/sys-user.entity.js';
import { WorkOrder } from '../../entities/work-order.entity.js';
import { WorkTask } from '../../entities/work-task.entity.js';

import { TasksController } from './tasks.controller.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { WorkOrdersService } from './work-orders.service.js';

/**
 * B2 工单与工序任务模块。
 *
 * ⚠️ 本模块**不提供**「随意创建工单 / 随意创建任务」接口（契约 §6.3 明文禁止），
 * 也不提供 APS 自动排产。工单只能由订单确认闭环产生。
 *
 * ⚠️ `Device` / `SysUser` 是 B2 数据模型的一部分（`work_task.device_code` /
 * `operator_id` 在 SQL 中**没有外键**，服务端必须自行校验存在性）。
 * 本版因 Q2 未决**不启用任务分配写入**，因此这两个实体当前只注册、不读写；
 * 保留注册是因为 `autoLoadEntities: true` 要求实体必须经 `forFeature` 注册，
 * 且 `test/route-registration.e2e-spec.ts` 的实体注册守卫会校验"实体文件 ↔ 注册"一一对应。
 */
@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, WorkTask, Device, SysUser])],
  controllers: [WorkOrdersController, TasksController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
