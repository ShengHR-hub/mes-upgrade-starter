import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Product } from '../../entities/product.entity.js';

import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

/**
 * 产品主数据最小只读模块（S5 为 B1 订单补充；不扩展为 B5）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
