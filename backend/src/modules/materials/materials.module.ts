import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Bom } from '../../entities/bom.entity.js';
import { Material } from '../../entities/material.entity.js';
import { Product } from '../../entities/product.entity.js';
import { AuditModule } from '../audit/audit.module.js';

import { BomsController } from './boms.controller.js';
import { BomsService } from './boms.service.js';
import { MaterialsController } from './materials.controller.js';
import { MaterialsService } from './materials.service.js';
import { ProductBomsController } from './boms.controller.js';

/**
 * B5 物料管理模块（契约 §6.6）。
 *
 * 路由：
 * - `GET/PATCH /api/v1/materials…`
 * - `GET/POST /api/v1/products/{code}/boms`、`PATCH/DELETE /api/v1/boms/{id}`
 *
 * `forFeature` 注册 `Material / Bom / Product`：事务内 `manager.query` 与引用保护
 * 查询依赖实体元数据已加载（漏注册会在事务内抛 No metadata → 整笔回滚，由
 * `test/route-registration.e2e-spec.ts` 守卫）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Material, Bom, Product]), AuditModule],
  controllers: [MaterialsController, ProductBomsController, BomsController],
  providers: [MaterialsService, BomsService],
  exports: [MaterialsService, BomsService],
})
export class MaterialsModule {}
