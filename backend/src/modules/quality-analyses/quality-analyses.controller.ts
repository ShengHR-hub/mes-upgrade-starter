import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';

import {
  GoodRateQueryDto,
  ParetoQueryDto,
  TrendQueryDto,
} from './dto/quality-analysis-query.dto.js';
import { QualityAnalysesService } from './quality-analyses.service.js';

/**
 * B11 SPC 质量分析控制器 —— 契约 §6.5。
 * 权限（契约 §5.2 第 21 行）：GET /quality-analyses/* → admin / manager；operator 拒绝。
 *
 * 只读分析接口：无写操作，不写审计（与 B8 驾驶舱一致）；
 * 全部响应标注 `dataSource:"demo"` / `dataLabel:"演示数据"`。
 */
@Controller('api/v1/quality-analyses')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager')
export class QualityAnalysesController {
  constructor(private readonly service: QualityAnalysesService) {}

  @Get('paretos')
  async paretos(@Query() query: ParetoQueryDto) {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.service.pareto(query, snapshotAt);
  }

  @Get('trends')
  async trends(@Query() query: TrendQueryDto) {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.service.trends(query, snapshotAt);
  }

  @Get('good-rates')
  async goodRates(@Query() query: GoodRateQueryDto) {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.service.goodRates(query, snapshotAt);
  }
}
