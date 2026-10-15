import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import {
  ListDeviceStateLogsQueryDto,
  ListDevicesQueryDto,
} from './dto/list-devices-query.dto.js';
import { DeviceStateTransitionDto } from './dto/device-state-transition.dto.js';
import { DevicesService } from './devices.service.js';

/**
 * B7 设备管理 —— 契约 §6.7。
 *
 * 权限（契约 §5.2）：
 * - `GET /devices`、详情、状态日志、`POST 设备 state-transitions` → 三角色可操作（第 12、13 行）；
 * - `GET 设备 oee-analyses` → 仅 admin / manager（第 14 行）。
 *
 * ⚠️ Q3（剩余）：允许状态迁移与停机超时阈值未获批准 → `state-transitions` 入口虽按
 * S5 先例注册，但**对任何流转返回 30006**，不写 device / equipment_log、不启用
 * 自动停机告警；EQP-SMT-006 演示固定「维修中/加热区故障」约束因此不受影响。
 */
@Controller('api/v1/devices')
@UseGuards(AuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** GET /api/v1/devices —— 设备列表 */
  @Get()
  list(@Query() query: ListDevicesQueryDto) {
    return this.devices.list(query);
  }

  /**
   * POST /api/v1/devices/{code}/state-transitions —— 状态迁移（当前全部 30006）。
   *
   * 保留 expectedStatus 严格校验：并发冲突返回 30003 而不是覆盖新状态；
   * 因 Q3 未批准，任何 targetStatus 一律 30006（写入入口保持关闭）。
   */
  @Post(':code/state-transitions')
  @HttpCode(HttpStatus.OK)
  transition(@Param('code') code: string, @Body() dto: DeviceStateTransitionDto) {
    return this.devices.transition(code, dto.expectedStatus, dto.targetStatus);
  }

  /** GET /api/v1/devices/{code}/state-logs —— 状态日志（只读；半开日期区间） */
  @Get(':code/state-logs')
  listStateLogs(@Param('code') code: string, @Query() query: ListDeviceStateLogsQueryDto) {
    return this.devices.listStateLogs(code, query);
  }

  /**
   * GET /api/v1/devices/{code}/oee-analyses —— OEE 查询（admin/manager）。
   *
   * 缺输入返回 null + insufficient_data + missingInputs（Q3 验收口径）。
   */
  @Get(':code/oee-analyses')
  @RequireRoles('admin', 'manager')
  oee(@Param('code') code: string) {
    return this.devices.oee(code);
  }

  /** GET /api/v1/devices/{code} —— 设备详情 */
  @Get(':code')
  detail(@Param('code') code: string) {
    return this.devices.detail(code);
  }
}
