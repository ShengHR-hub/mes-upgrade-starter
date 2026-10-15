import { ValidateIf } from 'class-validator';

/**
 * 「可选但**不允许 `null`**」——只跳过 `undefined`（未传），不跳过 `null`。
 *
 * 为什么需要它：class-validator 的 `@IsOptional()` 对 `null` 与 `undefined`
 * **都跳过**后续校验。这在契约明示 `field?:type/null`（null 表示清空）的字段上
 * 正好合用；但在契约**没有** `null` 的字段上会让 `null` 绕过类型校验，
 * 一路走到数据库（NOT NULL 列）才报错，表现为 500 而非 10001。
 *
 * 用法：替换 `@IsOptional()`，其余校验器照旧声明即可。
 * `null` 会进入后续校验器（如 `@IsInt`）并被正常拒绝 → 10001。
 *
 * 契约对照：
 * - `PATCH /orders/{id}`：`productCode?:string,qty?:int,dueDate?:date` → **无 null，用本装饰器**
 * - `PATCH /work-orders/{id}`：`planStart?:date/null,planEnd?:date/null` → **有 null，仍用 `@IsOptional()`**
 * - `PATCH /tasks/{id}`：`…?:type/null` → **有 null，仍用 `@IsOptional()`**
 */
export const IsOptionalNonNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
