import { Module } from '@nestjs/common';
import { QualityInspectionsController } from './quality-inspections.controller.js';
import { DefectsController } from './defects.controller.js';
import { QualityInspectionsService } from './quality-inspections.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [QualityInspectionsController, DefectsController],
  providers: [QualityInspectionsService]
})
export class QualityInspectionsModule {}
