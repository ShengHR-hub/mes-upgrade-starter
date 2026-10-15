import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy.js';

function toInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toBoolean(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * 启动闸门：表结构已由 `db/schema.sql` 冻结（18 张表，S1 定稿），
 * 绝不允许 TypeORM 自动建表 / 改表。
 *
 * 若环境里出现任何试图开启同步的配置，**直接抛错终止启动**，
 * 而不是静默忽略——避免"以为关掉了、实际改了表"的事故。
 */
function assertSynchronizeDisabled(config: ConfigService): void {
  if (toBoolean(config.get<string>('DB_SYNCHRONIZE'))) {
    throw new Error(
      '[FATAL] 检测到 DB_SYNCHRONIZE 被设为启用值。' +
        '数据库表结构已由 db/schema.sql 冻结，禁止 TypeORM 自动同步（synchronize 已在代码中写死为 false）。' +
        '请从 .env / 环境变量中移除 DB_SYNCHRONIZE 后重启。',
    );
  }
}

/**
 * 构建 TypeORM 连接选项。
 *
 * 连接目标：`smart_mes` @ MySQL841（127.0.0.1:3306）—— 见 `docs/handovers/s1-db.md`。
 * 账号口令一律来自 `.env`（已被 `.gitignore` 排除），代码中不含任何硬编码凭据。
 */
export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  assertSynchronizeDisabled(config);

  return {
    type: 'mysql',
    host: config.get<string>('DB_HOST') ?? '127.0.0.1',
    port: toInteger(config.get<string>('DB_PORT'), 3306),
    username: config.get<string>('DB_USERNAME') ?? 'root',
    password: config.get<string>('DB_PASSWORD') ?? '',
    database: config.get<string>('DB_DATABASE') ?? 'smart_mes',

    // 库与 18 张表均为 utf8mb4 / utf8mb4_unicode_ci（s1-db.md §4.3）
    charset: config.get<string>('DB_CHARSET') ?? 'utf8mb4',
    // 业务时区 Asia/Shanghai（契约 §2.1）
    timezone: config.get<string>('DB_TIMEZONE') ?? '+08:00',

    // ⚠️ 硬性约束：写死 false，不接受任何环境变量覆盖（见 assertSynchronizeDisabled）
    synchronize: false,
    migrationsRun: false,
    logging: toBoolean(config.get<string>('DB_LOGGING')),

    // 实体由后续会话按模块用 forFeature 注册，自动纳入本数据源
    autoLoadEntities: true,

    // BIGINT / 超范围 DECIMAL 一律以字符串返回，避免 JS 精度损失（契约 §2.1）
    supportBigNumbers: true,
    bigNumberStrings: true,

    // snake_case 列 ↔ camelCase 属性
    namingStrategy: new SnakeNamingStrategy(),

    connectTimeout: toInteger(config.get<string>('DB_CONNECT_TIMEOUT'), 10000),

    // 启动期连接失败的重试策略（NestJS 层选项）
    retryAttempts: 5,
    retryDelay: 2000,
  };
}
