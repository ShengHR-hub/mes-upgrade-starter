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

import { ListTasksQueryDto } from './dto/list-tasks-query.dto.js';
import { ListWorkOrdersQueryDto } from './dto/list-work-orders-query.dto.js';
import { WorkOrderStateTransitionDto } from './dto/state-transition.dto.js';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto.js';
import { WorkOrdersService } from './work-orders.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B2 工单 —— 契约 §6.3。
 *
 * 权限（契约 §5.2 第 6、7 行）：
 * - `GET /work-orders`、`GET /work-orders/{id}`、`GET /work-orders/{id}/tasks` → 三角色均可读；
 * - `PATCH /work-orders/{id}`（计划）、`POST /work-orders/{id}/state-transitions` → 仅 admin / manager。
 *
 * 方法级 `@RequireRoles` 覆盖类级声明；未声明的读接口只需登录（由 `AuthGuard` 保证）。
 */
@Controller('api/v1/work-orders')
@UseGuards(AuthGuard, RolesGuard)
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  /** GET /api/v1/work-orders —— 列表（三角色可读） */
  @Get()
  list(@Query() query: ListWorkOrdersQueryDto) {
    return this.workOrders.list(query);
  }

  /** GET /api/v1/work-orders/{id} —— 详情（三角色可读） */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workOrders.findOne(id);
  }

  /** GET /api/v1/work-orders/{id}/tasks —— 工序任务列表（三角色可读） */
  @Get(':id/tasks')
  listTasks(@Param('id') id: string, @Query() query: ListTasksQueryDto) {
    return this.workOrders.listTasks(id, query);
  }

  /** PATCH /api/v1/work-orders/{id} —— 修改计划（仅待启动；admin/manager） */
  @Patch(':id')
  @RequireRoles('admin', 'manager')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateWorkOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.workOrders.updatePlan(id, dto, { userId: user.id, ip: clientIp(request) });
  }

  /**
   * POST /api/v1/work-orders/{id}/state-transitions —— 工单状态流转（admin/manager）。
   *
   * 本版仅开放需求主线 `待启动 → 在产 → 完工`；涉及暂停/恢复/关闭一律 30006（Q2 未决）。
   * 显式声明 200：本接口是动作接口，不产生新的独立资源。
   */
  @Post(':id/state-transitions')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('admin', 'manager')
  transition(
    @Param('id') id: string,
    @Body() dto: WorkOrderStateTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.workOrders.transitionWorkOrder(id, dto, { userId: user.id, ip: clientIp(request) });
  }
}
