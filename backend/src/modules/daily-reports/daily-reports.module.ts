import { Module } from '@nestjs/common';

import { AiProxyModule } from '../ai-proxy/ai-proxy.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { DashboardsModule } from '../dashboards/dashboards.module.js';

import { DailyReportsController } from './daily-reports.controller.js';
import { DailyReportsService } from './daily-reports.service.js';

@Module({
  imports: [DashboardsModule, AlertsModule, AiProxyModule],
  controllers: [DailyReportsController],
  providers: [DailyReportsService],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
