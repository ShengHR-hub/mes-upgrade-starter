import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { GenerateDailyReportDto } from './dto/generate-daily-report.dto.js';
import type { DailyReportResponse } from './dto/daily-report-response.dto.js';
import { DailyReportsService } from './daily-reports.service.js';

/**
 * AI 生产日报控制器（F2 / 契约 §7.2）。
 * 权限（契约 §5.2 第 14 行）：
 * - POST /daily-reports 仅允许 admin 访问；
 * - manager / operator 角色服务端严格拒绝（抛 20004 FORBIDDEN）。
 */
@Controller('api/v1/daily-reports')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin')
export class DailyReportsController {
  constructor(private readonly dailyReportsService: DailyReportsService) {}

  @Post()
  async generate(
    @Body() dto: GenerateDailyReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DailyReportResponse> {
    return this.dailyReportsService.generateDailyReport(dto, user);
  }
}
