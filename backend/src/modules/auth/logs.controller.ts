import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { ListAiQueryLogsQueryDto, ListAuditLogsQueryDto } from './dto/list-logs-query.dto.js';
import { LogsService } from './logs.service.js';

/**
 * 只读日志与权限清单接口 —— 契约 §5.3（仅 admin）。
 *
 * - `GET /audit-logs`：操作审计日志（只读，无修改/删除接口）；
 * - `GET /ai-query-logs`：AI 查询日志（只读）；
 * - `GET /role-permissions`：三角色完整权限清单（契约 §5.2 矩阵）。
 */
@Controller('api/v1')
@UseGuards(AuthGuard, RolesGuard)
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  /** GET /api/v1/audit-logs —— 操作审计日志（只读） */
  @Get('audit-logs')
  @RequireRoles('admin')
  auditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.logs.listAuditLogs(query);
  }

  /** GET /api/v1/ai-query-logs —— AI 查询日志（只读） */
  @Get('ai-query-logs')
  @RequireRoles('admin')
  aiQueryLogs(@Query() query: ListAiQueryLogsQueryDto) {
    return this.logs.listAiQueryLogs(query);
  }

  /** GET /api/v1/role-permissions —— 三角色权限清单（完整） */
  @Get('role-permissions')
  @RequireRoles('admin')
  rolePermissions() {
    return this.logs.rolePermissions();
  }
}
