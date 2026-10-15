import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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

import { CreateMaterialBatchDto } from './dto/create-material-batch.dto.js';
import { ListMaterialBatchesQueryDto } from './dto/list-material-batches-query.dto.js';
import { MaterialBatchesService } from './material-batches.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * B5 物料批次 —— 契约 §6.6。
 *
 * 权限（契约 §5.2 第 10 行）：`GET/POST /material-batches`、`SN批次正反查询`
 * 均为三角色可操作（需登录）；无 operator 限制（本版 operator 共用批次操作权限）。
 *
 * ⚠️ `qty` 只表示入库数量，不称可用库存；无出库/占用/扣库存接口（契约 §6.6）。
 */
@Controller('api/v1/material-batches')
@UseGuards(AuthGuard, RolesGuard)
export class MaterialBatchesController {
  constructor(private readonly materialBatches: MaterialBatchesService) {}

  /** GET /api/v1/material-batches —— 批次列表（分页、半开日期区间） */
  @Get()
  list(@Query() query: ListMaterialBatchesQueryDto) {
    return this.materialBatches.list(query);
  }

  /**
   * POST /api/v1/material-batches —— 批次入库（201）。
   *
   * 入库与审计同一事务；批次号唯一冲突返回 30002。
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateMaterialBatchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.materialBatches.create(dto, { userId: user.id, ip: clientIp(request) });
  }

  /**
   * GET /api/v1/material-batches/{id}/sn-traces —— 批次反查绑定 SN（B6 关联读取）。
   *
   * 精确批次匹配；结果带演示标识，仅为单快照关联上下文。
   */
  @Get(':id/sn-traces')
  listSnTraces(@Param('id') id: string, @Query() query: ListMaterialBatchesQueryDto) {
    return this.materialBatches.listSnTraces(id, query);
  }
}
