import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../../common/constants/error-code.js';
import { createValidationPipe } from '../../../common/pipes/create-validation.pipe.js';

import { UpdateOrderDto } from './update-order.dto.js';

/**
 * `PATCH /orders/{id}` 请求体校验（走**真实的全局管道**，不是绕过它）。
 *
 * 回归背景（2026-10-10 S5 审查意见「订单 PATCH 未拒绝非法 null」）：
 * 初版用 `@IsOptional()`，而该装饰器对 `null` 与 `undefined` **都跳过**校验，
 * 使 `{"qty": null}` 通过管道直达 `manager.update()`，
 * 到数据库 NOT NULL 列才失败 —— 对外是 500 而不是 10001。
 * 现改用 `IsOptionalNonNull()`：只跳过 `undefined`，`null` 走正常校验被拒。
 */
const pipe = createValidationPipe();

function validate(payload: unknown): Promise<unknown> {
  return pipe.transform(payload, { type: 'body', metatype: UpdateOrderDto });
}

/**
 * 断言请求被拒绝且错误明细中包含指定字段。
 * 同一字段可能命中多个校验器（如 `qty: null` 会同时命中 `@IsInt` / `@Min` / `@Max`），
 * 因此只断言"包含该字段"，不要求数组长度精确相等。
 */
async function expectInvalid(payload: unknown, field: string): Promise<void> {
  let caught: unknown;
  try {
    await validate(payload);
  } catch (error) {
    caught = error;
  }
  expect(caught, `${JSON.stringify(payload)} 应被拒绝`).toBeDefined();

  const exception = caught as { code?: number; data?: { errors?: Array<{ field: string }> } };
  expect(exception.code, JSON.stringify(payload)).toBe(ErrorCode.INVALID_ARGUMENT);
  expect(
    (exception.data?.errors ?? []).map((item) => item.field),
    JSON.stringify(payload),
  ).toContain(field);
}

describe('UpdateOrderDto —— 契约未开放 null，必须显式拒绝', () => {
  it('接受合法字段（未传的字段保持 undefined）', async () => {
    await expect(validate({ qty: 120 })).resolves.toBeDefined();
    await expect(validate({ productCode: 'JC-PLC-2001' })).resolves.toBeDefined();
    await expect(validate({ dueDate: '2026-10-15' })).resolves.toBeDefined();
  });

  it('空对象在 DTO 层放行（"至少一个字段"由服务层判定）', async () => {
    await expect(validate({})).resolves.toBeDefined();
  });

  it('显式 null 一律 10001，且不会静默当成"清空"或"未传"', async () => {
    await expectInvalid({ qty: null }, 'qty');
    await expectInvalid({ productCode: null }, 'productCode');
    await expectInvalid({ dueDate: null }, 'dueDate');
  });

  it('类型错误仍被拒绝', async () => {
    await expectInvalid({ qty: '100' }, 'qty');
    await expectInvalid({ qty: 0 }, 'qty');
    await expectInvalid({ qty: 1.5 }, 'qty');
    await expectInvalid({ dueDate: '2026/10/15' }, 'dueDate');
    await expectInvalid({ productCode: '' }, 'productCode');
  });

  it('未知字段被拒绝（含客户端试图指定 createdBy / status / id）', async () => {
    await expectInvalid({ createdBy: '1' }, 'createdBy');
    await expectInvalid({ status: '已确认' }, 'status');
    await expectInvalid({ id: '101' }, 'id');
  });

  it('`null` 与「未传」语义严格区分：null 被拒，未传放行', async () => {
    // 同一字段两种写法，结果必须不同 —— 这是本用例的核心断言
    await expect(validate({ dueDate: '2026-10-15' })).resolves.toBeDefined();
    await expect(validate({ dueDate: null })).rejects.toBeTruthy();
  });
});
