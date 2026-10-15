import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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

import { CreateReportDto } from './dto/create-report.dto.js';
import { ListReportsQueryDto } from './dto/list-reports-query.dto.js';
import { ReportsService } from './reports.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B3 生产报工 —— 契约 §6.4。
 * 权限（契约 §5.2 第 8 行）：GET / POST /reports → 三角色（admin, manager, operator）均可访问。
 */
@Controller('api/v1/reports')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager', 'operator')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  async list(@Query() query: ListReportsQueryDto) {
    return this.reportsService.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.reportsService.create(dto, {
      userId: user.id,
      ip: clientIp(request),
    });
  }
}
