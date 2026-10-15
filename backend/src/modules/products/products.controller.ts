import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { ListProductsQueryDto } from './dto/list-products-query.dto.js';
import { ProductsService } from './products.service.js';

/**
 * 产品主数据只读接口 —— 契约 §6.6。
 *
 * 权限（契约 §5.2 第 3 行）：`GET /products` → 三角色均可读（需登录）。
 *
 * ⚠️ 这是 S5 的**最小只读补充**，只为订单选择产品服务；不实现 B5 其余接口。
 */
@Controller('api/v1/products')
@UseGuards(AuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** GET /api/v1/products —— 产品列表（分页） */
  @Get()
  list(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }
}
