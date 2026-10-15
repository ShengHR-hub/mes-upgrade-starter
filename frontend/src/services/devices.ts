/**
 * B7 设备管理服务（契约 §6.7）。
 *
 * 状态迁移：Q3（允许流转表 / 停机超时阈值）未获用户批准前，服务端对任何
 * targetStatus 返回 30006（写入入口关闭）。本服务保留调用以便前端如实展示
 * 服务端拒绝原因，**不伪造本地状态变更**。
 */

import { httpGet, httpPost } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type {
  Device,
  DeviceListQuery,
  DeviceOee,
  DeviceStateLog,
  DeviceStateLogListQuery,
} from '@/types/device'

export const devicesService = {
  /** GET /api/v1/devices —— 设备列表 */
  list(query: DeviceListQuery = {}, signal?: AbortSignal): Promise<PageResult<Device>> {
    return httpGet<PageResult<Device>>('/devices', compactParams({ ...query }), { signal })
  },

  /** GET /api/v1/devices/{code} —— 设备详情 */
  detail(code: string, signal?: AbortSignal): Promise<Device> {
    return httpGet<Device>(`/devices/${encodeURIComponent(code)}`, undefined, { signal })
  },

  /** GET /api/v1/devices/{code}/state-logs —— 状态日志（只读） */
  listStateLogs(
    code: string,
    query: DeviceStateLogListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<DeviceStateLog>> {
    return httpGet<PageResult<DeviceStateLog>>(
      `/devices/${encodeURIComponent(code)}/state-logs`,
      compactParams({ ...query }),
      { signal },
    )
  },

  /** GET /api/v1/devices/{code}/oee-analyses —— OEE（admin/manager；缺输入返回缺失项） */
  oee(code: string, signal?: AbortSignal): Promise<DeviceOee> {
    return httpGet<DeviceOee>(`/devices/${encodeURIComponent(code)}/oee-analyses`, undefined, {
      signal,
    })
  },

  /**
   * POST /api/v1/devices/{code}/state-transitions —— 状态迁移（当前服务端一律 30006）。
   * expectedStatus 不匹配返回 30003；Q3 批准前任何流转被 30006 拒绝。
   */
  transition(
    code: string,
    payload: { expectedStatus: string; targetStatus: string; remark?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    return httpPost<unknown>(
      `/devices/${encodeURIComponent(code)}/state-transitions`,
      payload,
      { signal },
    )
  },
}
