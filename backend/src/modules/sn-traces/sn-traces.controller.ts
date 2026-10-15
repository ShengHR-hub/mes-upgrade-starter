import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import {
  CreateSnTraceDto,
  ExportSnTraceDto,
  ListSnTracesQueryDto,
  UpdateSnTraceDto,
} from './dto/sn-trace.dto.js';
import { SnTracesService } from './sn-traces.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B6 SN 追溯 —— 契约 §6.6。
 *
 * 权限（契约 §5.2 第 11 行）：`GET /sn-traces`、SN 详情、导出；`POST/PATCH SN记录`
 * → 三角色均可操作（需登录），本版 operator 共用（无岗位细分）。
 *
 * 追溯口径：`sn` 精确匹配；详情/导出保留 coverage 与 limitations，仅作工单级
 * 关联上下文，不宣称逐工序已证实历史或 IATF 16949 合规。
 */
@Controller('api/v1/sn-traces')
@UseGuards(AuthGuard, RolesGuard)
export class SnTracesController {
  constructor(private readonly snTraces: SnTracesService) {}

  /** GET /api/v1/sn-traces —— SN 列表（sn 精确匹配） */
  @Get()
  list(@Query() query: ListSnTracesQueryDto) {
    return this.snTraces.list(query);
  }

  /**
   * GET /api/v1/sn-traces/{sn} —— 详情（单快照 + 工单级上下文 + coverage/limitations）。
   *
   * 路由顺序注意：`{sn}` 通配不得覆盖 `{sn}/exports`，Nest 按注册顺序匹配，
   * 因此本通配详情路由注册在后。
   */
  @Get(':sn')
  detail(@Param('sn') sn: string) {
    return this.snTraces.detail(sn);
  }

  /** POST /api/v1/sn-traces —— 创建 SN 快照（201；productCode 从工单取、operatorId 取身份） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateSnTraceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.snTraces.create(dto, { userId: user.id, ip: clientIp(request) });
  }

  /** PATCH /api/v1/sn-traces/{sn} —— 更新当前快照（不修改 producedAt） */
  @Patch(':sn')
  update(
    @Param('sn') sn: string,
    @Body() dto: UpdateSnTraceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.snTraces.update(sn, dto, { userId: user.id, ip: clientIp(request) });
  }

  /** POST /api/v1/sn-traces/{sn}/exports —— JSON 追溯导出（Q7：仅 JSON，保留限制说明） */
  @Post(':sn/exports')
  @HttpCode(HttpStatus.OK)
  export(@Param('sn') sn: string, @Body() dto: ExportSnTraceDto) {
    return this.snTraces.export(sn, dto.format);
  }
}
