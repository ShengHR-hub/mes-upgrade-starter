import { describe, expect, it, vi } from 'vitest';

import { KnowledgeService } from './knowledge.service.js';

const mockUser = { id: '7', role: 'manager', username: 'planner01' } as any;

function makeAiProxyMock(overrides: Record<string, any> = {}) {
  return {
    callRagAnswers: vi.fn(async () => ({
      answerStatus: 'answered',
      answer: '根据企业资料记载（企业数据·设备清单）：设备编号：EQP-SMT-006。',
      citations: [{ sourceName: '企业数据·设备清单', chunkId: 'kb-018', relevance: 1 }],
      knowledgeSource: 'enterprise-documents',
      mode: 'local',
      degraded: false,
      usage: { tokensIn: 0, tokensOut: 0 },
      latencyMs: 6,
    })),
    callKnowledgeSources: vi.fn(async () => ({
      list: [{ sourceName: '企业数据·设备清单', chunkCount: 2, dataSource: 'enterprise-documents' }],
      total: 1,
      page: 1,
      pageSize: 50,
      chunkTotal: 31,
    })),
    logAiQuery: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('KnowledgeService（F1 RAG 代理）', () => {
  it('answer 组装内部请求：topK 默认 3，userContext 来自当前用户，requestId 非空', async () => {
    const proxy = makeAiProxyMock();
    const service = new KnowledgeService(proxy as any);

    const res = await service.answer({ question: 'EQP-SMT-006 是什么设备？' }, mockUser);

    expect(proxy.callRagAnswers).toHaveBeenCalledTimes(1);
    const payload = proxy.callRagAnswers.mock.calls[0][0];
    expect(payload.question).toBe('EQP-SMT-006 是什么设备？');
    expect(payload.topK).toBe(3);
    expect(payload.userContext).toEqual({ userId: '7', role: 'manager' });
    expect(typeof payload.requestId).toBe('string');
    expect(payload.requestId.length).toBeGreaterThan(0);

    // 响应原样透传，不改写任何字段
    expect(res.answerStatus).toBe('answered');
    expect(res.citations[0].chunkId).toBe('kb-018');
    expect(res.mode).toBe('local');
  });

  it('answer 透传显式 topK（1~5）', async () => {
    const proxy = makeAiProxyMock();
    const service = new KnowledgeService(proxy as any);
    await service.answer({ question: '测试', topK: 5 }, mockUser);
    expect(proxy.callRagAnswers.mock.calls[0][0].topK).toBe(5);
  });

  it('answer 成功后写一条 kind=rag 审计（含答案与用量）', async () => {
    const proxy = makeAiProxyMock();
    const service = new KnowledgeService(proxy as any);
    await service.answer({ question: '测试问题' }, mockUser);

    expect(proxy.logAiQuery).toHaveBeenCalledTimes(1);
    const log = proxy.logAiQuery.mock.calls[0][0];
    expect(log.kind).toBe('rag');
    expect(log.userId).toBe('7');
    expect(log.question).toBe('测试问题');
    expect(log.status).toBe('成功');
    expect(log.answer).toContain('EQP-SMT-006');
    expect(log.latencyMs).toBe(6);
  });

  it('degraded 响应记 status=降级', async () => {
    const proxy = makeAiProxyMock({
      callRagAnswers: vi.fn(async () => ({
        answerStatus: 'answered',
        answer: '回退本地检索的答案',
        citations: [],
        mode: 'local',
        degraded: true,
        usage: { tokensIn: 0, tokensOut: 0 },
        latencyMs: 12,
      })),
    });
    const service = new KnowledgeService(proxy as any);
    const res = await service.answer({ question: '测试' }, mockUser);
    expect(res.degraded).toBe(true);
    expect(proxy.logAiQuery.mock.calls[0][0].status).toBe('降级');
  });

  it('AI 服务异常时：写失败审计并向上抛错（不返回伪答案）', async () => {
    const boom = new Error('AI 服务不可用');
    const proxy = makeAiProxyMock({ callRagAnswers: vi.fn(async () => { throw boom; }) });
    const service = new KnowledgeService(proxy as any);

    await expect(service.answer({ question: '测试' }, mockUser)).rejects.toThrow('AI 服务不可用');
    expect(proxy.logAiQuery).toHaveBeenCalledTimes(1);
    expect(proxy.logAiQuery.mock.calls[0][0].status).toBe('失败');
    expect(proxy.logAiQuery.mock.calls[0][0].answer).toBeNull();
  });

  it('not_found（超纲拒答）也如实写审计', async () => {
    const proxy = makeAiProxyMock({
      callRagAnswers: vi.fn(async () => ({
        answerStatus: 'not_found',
        answer: '资料中没有相关信息',
        citations: [],
        reason: '所问内容不在企业资料范围内',
        mode: 'local',
        degraded: false,
        usage: { tokensIn: 0, tokensOut: 0 },
        latencyMs: 5,
      })),
    });
    const service = new KnowledgeService(proxy as any);
    const res = await service.answer({ question: '公司明年营收目标' }, mockUser);
    expect(res.answerStatus).toBe('not_found');
    expect(proxy.logAiQuery.mock.calls[0][0].status).toBe('成功');
  });

  it('listSources 透传分页参数并原样返回', async () => {
    const proxy = makeAiProxyMock();
    const service = new KnowledgeService(proxy as any);
    const res = await service.listSources({ page: 2, pageSize: 10 }, mockUser);

    expect(proxy.callKnowledgeSources).toHaveBeenCalledWith({ page: 2, pageSize: 10 }, expect.any(String));
    expect(res.total).toBe(1);
    expect(res.list[0].sourceName).toBe('企业数据·设备清单');
  });
});
