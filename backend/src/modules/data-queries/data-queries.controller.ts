import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { DataQueryDto } from './dto/data-query.dto.js';
import type { QueryAnswerResponse } from './dto/query-answer-response.dto.js';
import { DataQueriesService } from './data-queries.service.js';

/**
 * F3 智能问数控制器（契约 §7.1）。
 * 权限（契约 §5.2 第 18 行）：
 * - POST /data-queries 仅允许 admin / manager；
 * - operator 服务端严格拒绝（抛 20004 FORBIDDEN），前端隐藏入口不是鉴权。
 */
@Controller('api/v1/data-queries')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager')
export class DataQueriesController {
  constructor(private readonly dataQueriesService: DataQueriesService) {}

  @Post()
  async query(
    @Body() dto: DataQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QueryAnswerResponse> {
    return this.dataQueriesService.queryData(dto, user);
  }
}
