import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProcessRoute } from '../../entities/process-route.entity.js';
import { Product } from '../../entities/product.entity.js';
import { SaleOrder } from '../../entities/sale-order.entity.js';
import { WorkOrder } from '../../entities/work-order.entity.js';
import { WorkTask } from '../../entities/work-task.entity.js';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/**
 * B1 生产订单模块。
 *
 * `forFeature` 同时承担两个职责：
 * 1. 让本模块可注入这些实体的 Repository；
 * 2. 在 `autoLoadEntities: true` 下把实体元数据注册进全局 DataSource
 *    （否则事务内的 `manager.find(Entity)` 会报「实体元数据未找到」）。
 *
 * ⚠️ 全部为**只读映射**，且 `synchronize` 已在 `typeorm.config.ts` 写死为 false，
 * 不会对 `db/schema.sql` 冻结的 18 张表产生任何结构变更。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SaleOrder, WorkOrder, WorkTask, ProcessRoute, Product])],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
