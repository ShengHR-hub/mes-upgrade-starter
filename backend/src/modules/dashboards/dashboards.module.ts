import { Module } from '@nestjs/common';

import { DashboardsController } from './dashboards.controller.js';
import { MetricsAggregationService } from './metrics-aggregation.service.js';

@Module({
  controllers: [DashboardsController],
  providers: [MetricsAggregationService],
  exports: [MetricsAggregationService],
})
export class DashboardsModule {}
