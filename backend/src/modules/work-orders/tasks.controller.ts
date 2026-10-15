import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { TaskStateTransitionDto } from './dto/state-transition.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { WorkOrdersService } from './work-orders.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * 工序任务 —— 契约 §6.3。
 *
 * 权限（契约 §5.2 第 6、7 行）：
 * - `GET /tasks/{id}` → 三角色可读；
 * - `PATCH /tasks/{id}`、`POST /tasks/{id}/state-transitions` → 仅 admin / manager。
 *
 * ⚠️ **Q2 未获批准前，两个写接口均不启用写入**（服务层返回 `30006`）：
 * 任务分配与相关状态迁移的规则（设备 / 操作员分配条件、工序顺序前置条件）尚未确认，
 * 用户已于 2026-10-10 明确裁决"不启用写入、不能仅靠存在性校验开放操作"。
 */
@Controller('api/v1/tasks')
@UseGuards(AuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  /** GET /api/v1/tasks/{id} —— 详情（三角色可读） */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workOrders.findTask(id);
  }

  /**
   * `PATCH /api/v1/tasks/{id}` —— **Q2 未获批准前不启用写入**（返回 30006）。
   *
   * 路由保留（契约 §6.3 已冻结该接口形状），但服务层一律拒绝写入；
   * 权限守卫仍先生效，因此 operator 得到 403、admin/manager 得到 30006。
   */
  @Patch(':id')
  @RequireRoles('admin', 'manager')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.workOrders.updateTask(id, dto, { userId: user.id, ip: clientIp(request) });
  }

  /**
   * `POST /api/v1/tasks/{id}/state-transitions` —— **Q2 未获批准前不启用写入**（返回 30006）。
   *
   * 依据：任务 `待启动 → 在产` 隐含「已具备开工条件（设备 / 操作员已分配）」，
   * 而分配条件与工序顺序前置条件均待 Q2 确认。
   */
  @Post(':id/state-transitions')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('admin', 'manager')
  transition(
    @Param('id') id: string,
    @Body() dto: TaskStateTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.workOrders.transitionTask(id, dto, { userId: user.id, ip: clientIp(request) });
  }
}
