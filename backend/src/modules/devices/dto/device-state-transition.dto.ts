import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { DEVICE_STATUS_VALUES } from './list-devices-query.dto.js';

/**
 * `POST /api/v1/devices/{code}/state-transitions` 请求体（契约 §6.7）。
 *
 * `B expectedStatus:设备枚举,targetStatus:设备枚举,remark?:string`
 *
 * `expectedStatus` 是请求控制字段（不是表列）：与当前状态不一致时返回 30003，
 * 避免覆盖别人已完成的操作（契约 §2.4）。
 *
 * ⚠️ 目标流转是否允许由 `ALLOWED_DEVICE_TRANSITIONS`（Q3 待确认，当前为空）决定；
 * 未批准前任何 targetStatus 都在服务端被 30006 拒绝，不产生写入。
 */
export class DeviceStateTransitionDto {
  @IsIn(DEVICE_STATUS_VALUES, {
    message: `expectedStatus 必须为 ${DEVICE_STATUS_VALUES.join(' / ')} 之一`,
  })
  expectedStatus!: string;

  @IsIn(DEVICE_STATUS_VALUES, {
    message: `targetStatus 必须为 ${DEVICE_STATUS_VALUES.join(' / ')} 之一`,
  })
  targetStatus!: string;

  @IsOptional()
  @IsString({ message: 'remark 必须为字符串' })
  @Length(1, 256, { message: 'remark 长度必须为 1~256 个字符' })
  remark?: string;
}
