import { Module } from '@nestjs/common';

import { AiProxyModule } from '../ai-proxy/ai-proxy.module.js';
import { DashboardsModule } from '../dashboards/dashboards.module.js';

import { DataQueriesController } from './data-queries.controller.js';
import { DataQueriesQueryExecutor } from './data-queries.query.js';
import { DataQueriesService } from './data-queries.service.js';

/**
 * F3 智能问数模块（S9 / 契约 §7.1）。
 *
 * - 复用 DashboardsModule 的 MetricsAggregationService（权威聚合口径）与 AiProxyModule
 *   的内部通信 / 审计能力；
 * - 查询执行器只经 DataSource 执行参数化 SQL（不新增实体注册，18 表冻结）。
 */
@Module({
  imports: [DashboardsModule, AiProxyModule],
  controllers: [DataQueriesController],
  providers: [DataQueriesQueryExecutor, DataQueriesService],
  exports: [DataQueriesService],
})
export class DataQueriesModule {}
