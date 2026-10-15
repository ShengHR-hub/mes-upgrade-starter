/**
 * 健康检查类型。
 *
 * 对应后端 S2 已实现的 `GET /health` 与 `GET /api/v1/health`
 * （见 docs/handovers/s2-backend-skeleton.md §3）。
 * 前端只调用契约路径 `/api/v1/health`（经同源代理到 3001）。
 */

export interface HealthDatabase {
  status: string
  latencyMs?: number
  version?: string
}

export interface HealthData {
  status: string
  service: string
  version: string
  uptimeSeconds: number
  timestamp: string
  database: HealthDatabase
}
