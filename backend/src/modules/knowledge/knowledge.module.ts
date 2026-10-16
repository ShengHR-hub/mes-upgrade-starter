import { Module } from '@nestjs/common';

import { AiProxyModule } from '../ai-proxy/ai-proxy.module.js';

import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * F1 企业知识问答模块（RAG 代理）—— 契约 §7.3。
 *
 * - 不新增实体注册（18 表冻结），不直连业务库；
 * - 仅经 AiProxyModule 的内部通信 / 审计能力调用 FastAPI。
 */
@Module({
  imports: [AiProxyModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
