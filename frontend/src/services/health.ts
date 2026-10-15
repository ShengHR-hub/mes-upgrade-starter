/**
 * 健康检查服务。
 *
 * 调用后端 S2 已实现的健康接口（契约 §8：`/health` 为运维检查，
 * `/api/v1/health` 为版本化入口）。前端统一走 `/api/v1/health`，
 * 经同源代理转发到 NestJS 3001。
 *
 * 该接口是**公开运维接口**，不是业务接口，也不返回任何业务数据。
 */

import { httpGet } from './http'

import type { HealthData } from '@/types/health'

export const healthService = {
  get(signal?: AbortSignal): Promise<HealthData> {
    return httpGet<HealthData>('/health', undefined, { signal })
  },
}
