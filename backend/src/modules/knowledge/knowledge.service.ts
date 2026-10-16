import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AiProxyService } from '../ai-proxy/ai-proxy.service.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';

import { RagAnswerDto } from './dto/rag-answer.dto.js';
import type {
  KnowledgeSourcesPageResponse,
  RagAnswerResponse,
} from './dto/knowledge-response.dto.js';
import type { UserContextDto } from '../ai-proxy/ai-proxy.types.js';

/**
 * F1 企业知识问答服务（RAG 代理）—— 契约 §7.3。
 *
 * 职责：
 * 1. 组装内部请求（question / topK / userContext / requestId）；
 * 2. 经 AiProxyService 调用 FastAPI 内部接口（注入 AI_SERVICE_TOKEN）；
 * 3. 写 ai_query_log（kind='rag'）；
 * 4. 不触碰业务库、不解释答案内容（答案由 AI 服务与知识库产生）。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly aiProxy: AiProxyService) {}

  async answer(dto: RagAnswerDto, user: AuthenticatedUser): Promise<RagAnswerResponse> {
    const requestId = randomUUID();
    const userContext: UserContextDto = {
      userId: String(user.id),
      role: user.role,
    };
    const topK = dto.topK ?? 3;

    let result: RagAnswerResponse;
    let status: '成功' | '失败' | '降级' = '成功';
    try {
      result = await this.aiProxy.callRagAnswers({
        question: dto.question,
        topK,
        userContext,
        requestId,
      });
    } catch (err: any) {
      status = '失败';
      // 依赖不可用：写审计后向上抛业务异常（不返回伪答案）
      await this.aiProxy.logAiQuery({
        userId: userContext.userId,
        kind: 'rag',
        question: dto.question,
        answer: null,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        status,
      });
      throw err;
    }

    if (result.degraded) {
      status = '降级';
    }

    await this.aiProxy.logAiQuery({
      userId: userContext.userId,
      kind: 'rag',
      question: dto.question,
      answer: result.answer,
      tokensIn: result.usage?.tokensIn ?? 0,
      tokensOut: result.usage?.tokensOut ?? 0,
      latencyMs: result.latencyMs ?? 0,
      status,
    });

    return result;
  }

  async listSources(
    query: { page?: number; pageSize?: number },
    _user: AuthenticatedUser,
  ): Promise<KnowledgeSourcesPageResponse> {
    const requestId = randomUUID();
    return this.aiProxy.callKnowledgeSources(query, requestId);
  }
}
