import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

import { CreateBomDto } from './dto/create-bom.dto.js';
import { UpdateBomDto } from './dto/update-bom.dto.js';
import { BomsService } from './boms.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B5 产品 BOM 读接口 —— 契约 §6.6。
 *
 * 权限（契约 §5.2 第 3 行）：`GET /products`、产品 BOM/工艺路线 → 三角色均可读。
 */
@Controller('api/v1/products/:productCode/boms')
@UseGuards(AuthGuard, RolesGuard)
export class ProductBomsController {
  constructor(private readonly boms: BomsService) {}

  /** GET /api/v1/products/{code}/boms —— BOM 列表（按 id 升序） */
  @Get()
  list(@Param('productCode') productCode: string, @Query() query: PaginationQueryDto) {
    return this.boms.listByProduct(productCode, query);
  }

  /** POST /api/v1/products/{code}/boms —— 新增 BOM 行（admin/manager；201） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles('admin', 'manager')
  create(
    @Param('productCode') productCode: string,
    @Body() dto: CreateBomDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.boms.create(productCode, dto, { userId: user.id, ip: clientIp(request) });
  }
}

/**
 * B5 BOM 行写接口 —— 契约 §6.6。
 *
 * 权限（契约 §5.2 第 4 行）：`POST/PATCH 产品 BOM；DELETE BOM` → 仅 admin / manager。
 *
 * ⚠️ 引用保护：产品有关联已确认订单或工单时，修改/删除返回 30004（服务端强制）。
 */
@Controller('api/v1/boms')
@UseGuards(AuthGuard, RolesGuard)
export class BomsController {
  constructor(private readonly boms: BomsService) {}

  /** PATCH /api/v1/boms/{id} —— 修改 level/qty/unit（admin/manager） */
  @Patch(':id')
  @RequireRoles('admin', 'manager')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBomDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.boms.update(id, dto, { userId: user.id, ip: clientIp(request) });
  }

  /** DELETE /api/v1/boms/{id} —— 删除 BOM 行（admin/manager；data:null） */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('admin', 'manager')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.boms.remove(id, { userId: user.id, ip: clientIp(request) });
  }
}
