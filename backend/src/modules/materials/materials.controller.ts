import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { ListMaterialsQueryDto } from './dto/list-materials-query.dto.js';
import { UpdateMaterialDto } from './dto/update-material.dto.js';
import { MaterialsService } from './materials.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B5 物料主数据 —— 契约 §6.6。
 *
 * 权限（契约 §5.2）：
 * - `GET /materials` → 三角色均可读（第 3 行）；
 * - `PATCH /materials/{code}`（安全库存）→ 仅 admin / manager（第 4 行）。
 */
@Controller('api/v1/materials')
@UseGuards(AuthGuard, RolesGuard)
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  /** GET /api/v1/materials —— 物料列表（企业主数据来源标识） */
  @Get()
  list(@Query() query: ListMaterialsQueryDto) {
    return this.materials.list(query);
  }

  /** PATCH /api/v1/materials/{code} —— 仅安全库存（admin/manager） */
  @Patch(':code')
  @RequireRoles('admin', 'manager')
  updateSafetyStock(
    @Param('code') code: string,
    @Body() dto: UpdateMaterialDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.materials.updateSafetyStock(code, dto, { userId: user.id, ip: clientIp(request) });
  }
}
