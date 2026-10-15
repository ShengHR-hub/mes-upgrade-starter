import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { redactForLog } from '../../common/utils/redact.util.js';
import type { DatabaseHealth, HealthResult } from './health.types.js';

/**
 * 健康检查服务：服务状态 + 数据库连通性（`SELECT 1`）。
 *
 * 数据库不可用时按契约 §3 抛 50002 DEPENDENCY_UNAVAILABLE（HTTP 503），
 * 而不是伪装成功；失败原因已脱敏，仅记服务端日志。
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<HealthResult> {
    const database = await this.probeDatabase();

    const result: HealthResult = {
      status: database.status === 'up' ? 'ok' : 'degraded',
      service: 'mes-backend',
      version: process.env.npm_package_version ?? '0.0.1',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: toShanghaiRfc3339(),
      database,
    };

    if (database.status === 'down') {
      throw new BusinessException(ErrorCode.DEPENDENCY_UNAVAILABLE, undefined, result);
    }

    return result;
  }

  private async probeDatabase(): Promise<DatabaseHealth> {
    const startedAt = Date.now();
    try {
      await this.dataSource.query('SELECT 1 AS ok');
      const version = await this.readVersion();
      return {
        status: 'up',
        latencyMs: Date.now() - startedAt,
        ...(version ? { version } : {}),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // 详细原因只进日志，不进响应体（避免泄露连接串、口令、SQL）。
      // 日志侧同样要脱敏：驱动报错常带 `mysql://user:pass@host` 形式的连接串（审查 P1）。
      this.logger.error(redactForLog(`数据库连通性检查失败：${reason}`));
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        reason: '数据库连接或查询失败，详见服务端日志',
      };
    }
  }

  private async readVersion(): Promise<string | undefined> {
    try {
      const rows = await this.dataSource.query<Array<{ version?: string }>>(
        'SELECT VERSION() AS version',
      );
      return rows[0]?.version;
    } catch {
      return undefined;
    }
  }
}
