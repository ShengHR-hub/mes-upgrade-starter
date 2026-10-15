import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';

import { MaterialRequirementCalculationDto } from './dto/material-requirement-calculation.dto.js';
import { MaterialRequirementsService } from './material-requirements.service.js';

/**
 * B12 MRP-lite 控制器 —— 契约 §6.10（受限）。
 * 权限（契约 §5.2 第 22 行）：POST /material-requirement-calculations → admin / manager。
 *
 * 只读计算：不持久化采购单、不写业务数据、无审计写入（与 B8/B11 只读口径一致）。
 */
@Controller('api/v1/material-requirement-calculations')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager')
export class MaterialRequirementsController {
  constructor(private readonly service: MaterialRequirementsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async calculate(@Body() dto: MaterialRequirementCalculationDto) {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.service.calculate(dto, snapshotAt);
  }
}
