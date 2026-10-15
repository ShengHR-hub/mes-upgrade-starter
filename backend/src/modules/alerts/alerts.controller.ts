import {
  Body,
  Controller,
  Get,
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

import { AlertStateTransitionDto } from './dto/alert-state-transition.dto.js';
import { ListAlertsQueryDto } from './dto/list-alerts-query.dto.js';
import type { RootCauseAnalysisResponse } from './dto/root-cause-analysis-response.dto.js';
import {
  AlertsService,
  type AlertItemResponse,
  type AlertStateTransitionResponse,
} from './alerts.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * 预警中心控制器（B10 / F4 / 契约 §6.9）。
 * 权限（契约 §5.2 第 16、17 行）：
 * - GET /alerts、GET /alerts/:id、POST /alerts/:id/state-transitions → admin / manager 可访问，operator 拒绝。
 * - POST /alerts/:id/root-cause-analyses → 仅 admin 可访问，manager / operator 严格 403 拒绝。
 * ⚠️ GET 接口严格只读，绝不暗中创建或更新预警；manager 读取预警绝不夹带根因分析内容。
 */
@Controller('api/v1/alerts')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async list(@Query() query: ListAlertsQueryDto) {
    return this.alertsService.list(query);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<AlertItemResponse> {
    return this.alertsService.getById(id);
  }

  @Post(':id/state-transitions')
  async transitionState(
    @Param('id') id: string,
    @Body() dto: AlertStateTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AlertStateTransitionResponse> {
    return this.alertsService.transitionState(id, dto, {
      userId: user.id,
      ip: clientIp(request),
    });
  }

  /**
   * 预警根因分析（POST /api/v1/alerts/:id/root-cause-analyses）
   * 仅管理员可用（覆盖类级 roles，严格仅 admin）。
   */
  @Post(':id/root-cause-analyses')
  @RequireRoles('admin')
  async analyzeRootCause(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RootCauseAnalysisResponse> {
    return this.alertsService.analyzeRootCause(id, user);
  }
}
