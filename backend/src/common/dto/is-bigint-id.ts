import { registerDecorator, type ValidationOptions } from 'class-validator';

import { isValidDecimalId } from '../utils/id.util.js';

/**
 * class-validator 版 BIGINT ID 校验（形态 + **容量上限**）。
 *
 * 与 `id.util.ts#isValidDecimalId()` 共用同一判据，避免"路径参数校验容量、查询参数只校验位数"
 * 这类不一致（审查 P2：「BIGINT 容量校验只限制位数…统一用于路径及查询 ID」）。
 *
 * 用法：`@IsBigintId({ message: 'xxx 必须为正整数（十进制字符串）' })`
 */
export function IsBigintId(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isBigintId',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown): boolean => isValidDecimalId(value),
      },
    });
  };
}
