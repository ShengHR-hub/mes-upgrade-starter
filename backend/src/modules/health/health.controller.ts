import { Controller, Get, Query } from '@nestjs/common';
import { HealthQueryDto } from './health-query.dto.js';
import { HealthService } from './health.service.js';
import type { HealthResult } from './health.types.js';

/**
 * 运维健康检查。
 *
 * 同时注册两个路径（`@Controller` 支持路径数组）：
 * - `/health`         —— 运维/容器探针入口（api-contract.md §8 明确其为运维检查）；
 * - `/api/v1/health`  —— 与契约 `/api/v1` 前缀一致的版本化入口。
 *
 * `@Query()` 绑定 `HealthQueryDto`（空 DTO）：本身不接收任何参数，
 * 但借全局 ValidationPipe 拒绝未知字段（契约 §2.1）。
 * 响应统一走全局包体拦截器：成功 `{code:0,message:"成功",data:{...}}`。
 */
@Controller(['health', 'api/v1/health'])
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(@Query() _query: HealthQueryDto): Promise<HealthResult> {
    return this.healthService.check();
  }
}
