import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { normalizePagination } from '../../common/dto/pagination.js';

import { ListKnowledgeSourcesQueryDto } from './dto/list-knowledge-sources-query.dto.js';
import { RagAnswerDto } from './dto/rag-answer.dto.js';
import type {
  KnowledgeSourcesPageResponse,
  RagAnswerResponse,
} from './dto/knowledge-response.dto.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * F1 企业知识问答控制器（RAG）—— 契约 §7.3 / §5.2 第 19 行。
 *
 * 权限：POST /rag-answers 与 GET /knowledge-sources 均允许三角色
 * （admin / manager / operator）——权限矩阵见 `common/auth/permission-matrix.ts`
 * （'rag-answers:create' / 'knowledge-sources:read' 均为 ALL）。
 *
 * 说明：答案由 AI 服务基于 knowledge.json 检索产生；资料中没有的信息明确拒答
 * （answerStatus=not_found），代理层不改写答案内容。
 */
@Controller('api/v1')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('admin', 'manager', 'operator')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('rag-answers')
  async answer(
    @Body() dto: RagAnswerDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RagAnswerResponse> {
    return this.knowledgeService.answer(dto, user);
  }

  @Get('knowledge-sources')
  async listSources(
    @Query() query: ListKnowledgeSourcesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<KnowledgeSourcesPageResponse> {
    const pagination = normalizePagination(query);
    return this.knowledgeService.listSources(
      { page: pagination.page, pageSize: pagination.pageSize },
      user,
    );
  }
}
