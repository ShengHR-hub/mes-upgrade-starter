import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './common/auth/auth.module.js';
import { buildTypeOrmOptions } from './config/typeorm.config.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { AiProxyModule } from './modules/ai-proxy/ai-proxy.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule as AuthSessionsModule } from './modules/auth/auth.module.js';
import { DailyReportsModule } from './modules/daily-reports/daily-reports.module.js';
import { DashboardsModule } from './modules/dashboards/dashboards.module.js';
import { DataQueriesModule } from './modules/data-queries/data-queries.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MaterialBatchesModule } from './modules/material-batches/material-batches.module.js';
import { MaterialRequirementsModule } from './modules/material-requirements/material-requirements.module.js';
import { MaterialsModule } from './modules/materials/materials.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { QualityAnalysesModule } from './modules/quality-analyses/quality-analyses.module.js';
import { QualityInspectionsModule } from './modules/quality-inspections/quality-inspections.module.js';
import { SnTracesModule } from './modules/sn-traces/sn-traces.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module.js';

/**
 * 应用根模块。
 *
 * 装配：
 * 1. `ConfigModule` —— 读取 `.env`（全局可用）；
 * 2. `TypeOrmModule` —— 连接 `smart_mes`，`synchronize: false` 写死不改表结构；
 * 3. `AuthModule`   —— 认证/授权占位（fail-closed，见 `common/auth/`）；
 * 4. `AuditModule`  —— 审计写入（同事务）；
 * 5. `HealthModule` —— `/health` 与 `/api/v1/health`；
 * 6. `ProductsModule`（最小只读主数据）/ `OrdersModule`（B1）/ `WorkOrdersModule`（B2）；
 * 7. `ReportsModule`（B3）/ `QualityInspectionsModule`（B4）；
 * 8. `DashboardsModule`（B8）/ `AlertsModule`（B10）；
 * 9. `AiProxyModule`（FastAPI 通信代理与审计日志）/ `DailyReportsModule`（F2 AI 日报）/
 *    `DataQueriesModule`（F3 智能问数）；
 * 10. S10/B9：`AuthSessionsModule`（登录/用户/权限清单/只读日志）；
 * 11. S10/B5：`MaterialsModule`（物料 + BOM）/ `MaterialBatchesModule`（批次）；
 * 12. S10/B6：`SnTracesModule`（SN 追溯与 JSON 导出）；
 * 13. S10/B7：`DevicesModule`（设备列表/详情/状态日志/OEE；Q3 未批准前状态迁移写入关闭）；
 * 14. S11/B11：`QualityAnalysesModule`（SPC：Pareto / 报工不良率趋势 / 报工良品率，只读）；
 * 15. S11/B12：`MaterialRequirementsModule`（MRP-lite 毛需求，只读；净缺口与采购量恒 null）。
 *     S11/B13 移动端 PWA 与 B14 开放 API 未启用边界见前端 `public/manifest.webmanifest`
 *     及 `test/route-registration.e2e-spec.ts`（integrations/* 保持 404/30001）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    AuthModule,
    AuditModule,
    HealthModule,
    ProductsModule,
    OrdersModule,
    WorkOrdersModule,
    ReportsModule,
    QualityInspectionsModule,
    DashboardsModule,
    AlertsModule,
    AiProxyModule,
    DailyReportsModule,
    DataQueriesModule,
    AuthSessionsModule,
    MaterialsModule,
    MaterialBatchesModule,
    SnTracesModule,
    DevicesModule,
    QualityAnalysesModule,
    MaterialRequirementsModule,
  ],
})
export class AppModule {}
