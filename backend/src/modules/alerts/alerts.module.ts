import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Alert } from '../../entities/alert.entity.js';
import { AiProxyModule } from '../ai-proxy/ai-proxy.module.js';
import { DashboardsModule } from '../dashboards/dashboards.module.js';

import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Alert]), DashboardsModule, AiProxyModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
