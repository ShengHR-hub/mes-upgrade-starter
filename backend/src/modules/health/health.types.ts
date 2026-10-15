/** 健康检查响应结构（`data` 部分）。 */

export interface DatabaseHealth {
  /** 连通性：`up` = SELECT 1 成功；`down` = 连接或查询失败。 */
  status: 'up' | 'down';
  /** 探测耗时（毫秒）。 */
  latencyMs: number;
  /** 数据库版本，取 `SELECT VERSION()`；探测失败时为 undefined。 */
  version?: string;
  /** 失败原因（已脱敏，不含连接串/口令）。 */
  reason?: string;
}

export interface HealthResult {
  /** 总体状态：`ok` = 全部依赖正常；`degraded` = 存在不可用依赖。 */
  status: 'ok' | 'degraded';
  /** 服务标识。 */
  service: string;
  /** 服务版本（取自 package.json version）。 */
  version: string;
  /** 进程运行时长（秒）。 */
  uptimeSeconds: number;
  /** 探测时刻，RFC 3339（业务时区 Asia/Shanghai，如 2026-10-09T08:30:00.000+08:00）。 */
  timestamp: string;
  /** 数据库连通性。 */
  database: DatabaseHealth;
}
