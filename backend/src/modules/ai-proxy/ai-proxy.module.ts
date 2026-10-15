import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiQueryLog } from '../../entities/ai-query-log.entity.js';
import { AiProxyService } from './ai-proxy.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AiQueryLog])],
  providers: [AiProxyService],
  exports: [AiProxyService],
})
export class AiProxyModule {}
