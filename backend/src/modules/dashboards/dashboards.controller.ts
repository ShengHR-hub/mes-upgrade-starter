import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';

import type {
  DashboardDeliveryMetricsResponse,
  DashboardDeviceMetricsResponse,
  DashboardProductionMetricsResponse,
  DashboardQualityMetricsResponse,
} from './dto/dashboard-response.dto.js';
import { DeliveryMetricsQueryDto } from './dto/delivery-metrics-query.dto.js';
import { DeviceMetricsQueryDto } from './dto/device-metrics-query.dto.js';
import { ProductionMetricsQueryDto } from './dto/production-metrics-query.dto.js';
import { QualityMetricsQueryDto } from './dto/quality-metrics-query.dto.js';
import { MetricsAggregationService } from './metrics-aggregation.service.js';

/**
 * 经营驾驶舱控制器（B8 / 契约 §6.8）。
 * 权限（契约 §5.2 第 15 行）：GET /dashboards/* → admin / manager 可访问，operator 拒绝。
 */
@Controller('api/v1/dashboards')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager')
export class DashboardsController {
  constructor(private readonly metricsService: MetricsAggregationService) {}

  @Get('production-metrics')
  async getProductionMetrics(
    @Query() query: ProductionMetricsQueryDto,
  ): Promise<DashboardProductionMetricsResponse> {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.metricsService.getProductionMetrics(query, snapshotAt);
  }

  @Get('quality-metrics')
  async getQualityMetrics(
    @Query() query: QualityMetricsQueryDto,
  ): Promise<DashboardQualityMetricsResponse> {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.metricsService.getQualityMetrics(query, snapshotAt);
  }

  @Get('device-metrics')
  async getDeviceMetrics(
    @Query() query: DeviceMetricsQueryDto,
  ): Promise<DashboardDeviceMetricsResponse> {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.metricsService.getDeviceMetrics(query, snapshotAt);
  }

  @Get('delivery-metrics')
  async getDeliveryMetrics(
    @Query() query: DeliveryMetricsQueryDto,
  ): Promise<DashboardDeliveryMetricsResponse> {
    const snapshotAt = toShanghaiRfc3339(new Date());
    return this.metricsService.getDeliveryMetrics(query, snapshotAt);
  }
}
