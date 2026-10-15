import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from '../../entities/audit-log.entity.js';

import { AuditService } from './audit.service.js';

/**
 * 审计模块（全局）：只提供写入能力，不提供任何读取/修改/删除接口
 * （契约 §5.3「不提供日志修改/删除接口」；读取属 B9 → S10）。
 *
 * ⚠️ 必须 `forFeature([AuditLog])`：`autoLoadEntities: true` **只加载
 * `forFeature` 注册过的实体**。漏注册时 `manager.insert(AuditLog, …)` 会抛
 * 「No metadata for "AuditLog" was found」，使整个订单创建/确认事务回滚。
 * 该遗漏由 `test/route-registration.e2e-spec.ts` 的实体注册守卫用例兜住。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
