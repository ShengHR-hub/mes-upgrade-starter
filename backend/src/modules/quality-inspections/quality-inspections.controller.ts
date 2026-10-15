import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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

import { CreateQualityInspectionDto } from './dto/create-quality-inspection.dto.js';
import { ListQualityInspectionsQueryDto } from './dto/list-quality-inspections-query.dto.js';
import { QualityInspectionsService } from './quality-inspections.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B4 质量检验 —— 契约 §6.5。
 * 权限（契约 §5.2 第 9 行）：GET / POST /quality-inspections → 三角色（admin, manager, operator）均可访问。
 */
@Controller('api/v1/quality-inspections')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager', 'operator')
export class QualityInspectionsController {
  constructor(private readonly qcService: QualityInspectionsService) {}

  @Get()
  async list(@Query() query: ListQualityInspectionsQueryDto) {
    return this.qcService.list(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.qcService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateQualityInspectionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.qcService.create(dto, {
      userId: user.id,
      ip: clientIp(request),
    });
  }
}
