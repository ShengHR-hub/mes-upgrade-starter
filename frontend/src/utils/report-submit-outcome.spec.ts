import { describe, expect, it } from 'vitest';

import { ApiError, type ApiErrorKind } from '@/services/api-error';

import { classifySubmitFailure } from './report-submit-outcome';

/**
 * 报工提交失败结局判定单测（S11 复审 P2 #2）。
 *
 * 核心语义：
 * - 「结果不明」→ 服务端可能已写入，禁止普通补交，转人工核查；
 * - 「明确拒绝」→ 服务端确定未写入，用户修正后可直接再次提交。
 */
function apiError(kind: ApiErrorKind): ApiError {
  return new ApiError({ kind, message: 'x' });
}

describe('classifySubmitFailure', () => {
  it('网络错误 / 超时 / 5xx / 响应不可解析 → 结果不明（可能已入账）', () => {
    for (const kind of ['network', 'timeout', 'server', 'dependency', 'malformed', 'unknown'] as const) {
      expect(classifySubmitFailure(apiError(kind)), kind).toBe('unknown-result');
    }
  });

  it('参数 / 冲突 / 无权限 / 未认证 / 业务拒绝 / 已取消 → 明确拒绝（未写入）', () => {
    for (const kind of [
      'business',
      'invalid-argument',
      'not-found',
      'conflict',
      'forbidden',
      'rate-limited',
      'unauthenticated',
      'canceled',
    ] as const) {
      expect(classifySubmitFailure(apiError(kind)), kind).toBe('definitely-rejected');
    }
  });

  it('非 API 错误（未知异常）按结果不明处理（保守）', () => {
    expect(classifySubmitFailure(new Error('boom'))).toBe('unknown-result');
    expect(classifySubmitFailure('weird')).toBe('unknown-result');
  });
});

