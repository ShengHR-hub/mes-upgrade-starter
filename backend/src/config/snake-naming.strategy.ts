import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

/** camelCase → snake_case（如 `saleOrderId` → `sale_order_id`）。 */
function snakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * 命名策略：实体属性 camelCase ↔ 数据库列 snake_case。
 *
 * 依据契约 §2.1「JSON 使用 UTF-8，字段 camelCase；数据库 snake_case 由 NestJS 映射，
 * **不改列名**」——本策略只影响 TypeORM 生成 SQL 时的列名映射，
 * 配合 `synchronize: false`，不会对 `db/schema.sql` 已定稿的表结构产生任何变更。
 *
 * 显式写在装饰器里的 `name` / `@Entity('xxx')` 优先级更高，仍会覆盖本策略。
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ?? snakeCase(targetName);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    if (customName) return customName;
    const prefix = embeddedPrefixes.filter((item) => item.length > 0);
    return snakeCase([...prefix, propertyName].join('_'));
  }
}
