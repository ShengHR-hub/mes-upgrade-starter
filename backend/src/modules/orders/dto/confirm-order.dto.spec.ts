import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../../common/constants/error-code.js';
import { createValidationPipe } from '../../../common/pipes/create-validation.pipe.js';

import { ConfirmOrderDto } from './confirm-order.dto.js';

/**
 * 回归背景（S5 审查 P2：「确认 DTO 接受契约外 expectedStatus」）。
 *
 * 契约 §6.2 把 `expectedStatus` 限定为字面量 `"待确认"`；
 * 初版误用全量订单枚举（`ORDER_STATUS_VALUES`），使 `"已完成"` 等契约外取值也能通过校验。
 * 「重复确认属于恢复读取」是**服务层**的例外，不等于可以放宽**入参校验**。
 *
 * 本用例走**真实的全局 ValidationPipe**（不绕过它）。
 */
const pipe = createValidationPipe();

function validate(payload: unknown): Promise<unknown> {
  return pipe.transform(payload, { type: 'body', metatype: ConfirmOrderDto });
}

async function expectInvalid(payload: unknown): Promise<void> {
  let caught: unknown;
  try {
    await validate(payload);
  } catch (error) {
    caught = error;
  }
  expect(caught, `${JSON.stringify(payload)} 应被拒绝`).toBeDefined();
  expect((caught as { code?: number }).code, JSON.stringify(payload)).toBe(
    ErrorCode.INVALID_ARGUMENT,
  );
}

describe('ConfirmOrderDto —— 只接受契约值 expectedStatus="待确认"', () => {
  it('接受契约值', async () => {
    await expect(validate({ expectedStatus: '待确认' })).resolves.toBeDefined();
  });

  it('**拒绝契约外的其他订单枚举**（核心回归）', async () => {
    for (const value of ['已完成', '已确认', '生产中', '已延期']) {
      await expectInvalid({ expectedStatus: value });
    }
  });

  it('拒绝任意字符串 / 空值 / 非字符串', async () => {
    await expectInvalid({ expectedStatus: 'anything' });
    await expectInvalid({ expectedStatus: '' });
    await expectInvalid({ expectedStatus: 0 });
    await expectInvalid({ expectedStatus: null });
  });

  it('缺失必填字段被拒绝', async () => {
    await expectInvalid({});
  });

  it('未知字段被拒绝（含客户端试图指定 status / orderId）', async () => {
    await expectInvalid({ expectedStatus: '待确认', status: '已确认' });
    await expectInvalid({ expectedStatus: '待确认', orderId: '101' });
  });
});
