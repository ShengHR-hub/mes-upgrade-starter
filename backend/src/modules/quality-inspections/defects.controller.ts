import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { ListDefectsQueryDto } from './dto/list-defects-query.dto.js';
import { QualityInspectionsService } from './quality-inspections.service.js';

/**
 * B4 质量检验 —— 不良品列表（契约 §6.5）。
 * 权限（契约 §5.2 第 9 行）：GET /defects → 三角色（admin, manager, operator）均可访问。
 */
@Controller('api/v1/defects')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager', 'operator')
export class DefectsController {
  constructor(private readonly qcService: QualityInspectionsService) {}

  @Get()
  async list(@Query() query: ListDefectsQueryDto) {
    return this.qcService.listDefects(query);
  }
}
