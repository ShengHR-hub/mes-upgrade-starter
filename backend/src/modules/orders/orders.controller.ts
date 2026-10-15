import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { ConfirmOrderDto } from './dto/confirm-order.dto.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { OrdersService } from './orders.service.js';

/**
 * B1 生产订单 —— 契约 §6.2。
 *
 * 权限（契约 §5.2 第 5 行）：
 * - `GET/POST/PATCH /orders`、`POST 订单 confirmations` → **仅 admin / manager**；
 * - operator 不可访问订单接口（由 `RolesGuard` 强制，前端隐藏按钮不能替代）。
 *
 * 认证由全局 JWT 守卫提供，
 * 因此 `AuthGuard` 在正常启动路径下对所有请求返回 401 —— 这是有意的 fail-closed 行为，
 * 保证「不允许匿名创建、修改或确认订单」。
 */
@Controller('api/v1/orders')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** GET /api/v1/orders —— 列表（分页 + 派生状态筛选，口径与详情一致） */
  @Get()
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  /** GET /api/v1/orders/{id} —— 详情 */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  /** POST /api/v1/orders —— 创建（201） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.orders.create(dto, { userId: user.id, ip: clientIp(request) });
  }

  /** PATCH /api/v1/orders/{id} —— 修改（仅待确认） */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.orders.update(id, dto, { userId: user.id, ip: clientIp(request) });
  }

  /**
   * POST /api/v1/orders/{id}/confirmations —— 确认订单（一单一工单，事务闭环）。
   *
   * 显式声明 200：本接口是**幂等动作**（重复调用返回现有唯一工单），
   * 不按「新建持久资源 201」处理；新建资源的 201 只用于 `POST /orders`。
   */
  @Post(':id/confirmations')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.orders.confirm(id, dto, { userId: user.id, ip: clientIp(request) });
  }
}

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}
