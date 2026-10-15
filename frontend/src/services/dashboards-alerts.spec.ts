import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { DashboardsService } from './dashboards'
import { AlertsService } from './alerts'
import { MODULES, pageRolesOf } from '@/config/modules'

type AdapterResult = { status: number; body: unknown; headers?: Record<string, string> }

let adapterCalls: Array<{ method: string; url: string; params: unknown; data: unknown }> = []
let nextResult: AdapterResult = { status: 200, body: { code: 0, message: '成功', data: null } }

function installAdapter(): void {
  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    adapterCalls.push({
      method: String(config.method ?? '').toUpperCase(),
      url: String(config.url ?? ''),
      params: config.params,
      data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    })
    return {
      data: nextResult.body,
      status: nextResult.status,
      statusText: String(nextResult.status),
      headers: nextResult.headers ?? {},
      config,
    } as AxiosResponse
  }
  ;(httpClient.defaults as { adapter?: unknown }).adapter = adapter
}

beforeEach(() => {
  adapterCalls = []
  nextResult = { status: 200, body: { code: 0, message: '成功', data: null } }
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(null)
  installAdapter()
})

afterEach(() => {
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(null)
})

describe('DashboardsService —— 契约 §6.8 (B8 经营驾驶舱)', () => {
  it('生产指标：GET /dashboards/production-metrics 展开传递筛选参数且不嵌套', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          startDate: '2026-10-01',
          endDate: '2026-10-07',
          metrics: {
            outputQty: 100,
            goodQty: 98,
            badQty: 2,
            planQty: 120,
            planTotalQty: 500,
            doneQty: 300,
            completionRate: 60.0,
            goodRate: 98.0,
            isTrueFpy: false,
            calculationStatus: 'available',
          },
          lines: [],
          snapshotAt: '2026-10-10T12:00:00.000+08:00',
        },
      },
    }

    const res = await DashboardsService.getProductionMetrics({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      productCode: 'PROD-001',
      prodLine: 'LINE-A',
      workshop: 'WS-01',
    })

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/dashboards/production-metrics')
    expect(adapterCalls[0]?.params).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      productCode: 'PROD-001',
      prodLine: 'LINE-A',
      workshop: 'WS-01',
    })
    expect(adapterCalls[0]?.params).not.toHaveProperty('params')
    expect(res.metrics.outputQty).toBe(100)
    expect(res.metrics.completionRate).toBe(60.0)
  })

  it('质量指标：GET /dashboards/quality-metrics 展开传递筛选参数', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          goodRate: 98.0,
          goodQty: 98,
          badQty: 2,
          isTrueFpy: false,
          snapshotAt: '2026-10-10T12:00:00.000+08:00',
        },
      },
    }

    const res = await DashboardsService.getQualityMetrics({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/dashboards/quality-metrics')
    expect(adapterCalls[0]?.params).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    expect(res.isTrueFpy).toBe(false)
    expect(res.goodRate).toBe(98.0)
  })

  it('设备指标：GET /dashboards/device-metrics 契约规范返回 OEE 为 null 及缺失原因', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          counts: {
            运行中: 8,
            待机: 2,
            维修中: 0,
            停机: 0,
          },
          oee: null,
          calculationStatus: 'insufficient_data',
          missingInputs: ['稼动率数据未接入 (OEE公式依赖不可用)'],
          snapshotAt: '2026-10-10T12:00:00.000+08:00',
        },
      },
    }

    const res = await DashboardsService.getDeviceMetrics()

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/dashboards/device-metrics')
    expect(res.oee).toBeNull()
    expect(res.calculationStatus).toBe('insufficient_data')
  })

  it('交付指标：GET /dashboards/delivery-metrics', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          orderCount: 20,
          completedOrderCount: 18,
          delayedOrderCount: 2,
          calculationStatus: 'available',
          snapshotAt: '2026-10-10T12:00:00.000+08:00',
        },
      },
    }

    const res = await DashboardsService.getDeliveryMetrics({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    })

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/dashboards/delivery-metrics')
    expect(res.delayedOrderCount).toBe(2)
  })
})

describe('AlertsService —— 契约 §6.9 (B10 预警中心)', () => {
  it('预警列表：GET /alerts 展开传递分页与筛选参数', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          list: [
            {
              id: '1',
              type: '质量预警',
              level: '重要',
              status: '未处理',
              title: '报工良品率低于阈值 (96.50% < 97%)',
              content: '末道工序报工良品率 96.50%',
              createdAt: '2026-10-10T08:00:00.000+08:00',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
    }

    const res = await AlertsService.list({
      page: 1,
      pageSize: 20,
      level: '重要',
      status: '未处理',
      type: '质量预警',
    })

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/alerts')
    expect(adapterCalls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      level: '重要',
      status: '未处理',
      type: '质量预警',
    })
    expect(res.list).toHaveLength(1)
  })

  it('预警详情：GET /alerts/:id', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          id: '1',
          type: '质量预警',
          level: '重要',
          status: '未处理',
          title: '报工良品率低',
          content: '详情描述',
          createdAt: '2026-10-10T08:00:00.000+08:00',
        },
      },
    }

    const alert = await AlertsService.getById('1')
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/alerts/1')
    expect(alert.id).toBe('1')
  })

  it('候选状态流转：POST /alerts/:id/state-transitions 正确发送请求体', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          id: '1',
          status: '已确认',
          updatedAt: '2026-10-10T12:05:00.000+08:00',
        },
      },
    }

    const updated = await AlertsService.transitionState('1', {
      expectedStatus: '未处理',
      targetStatus: '已确认',
    })

    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/alerts/1/state-transitions')
    expect(adapterCalls[0]?.data).toEqual({
      expectedStatus: '未处理',
      targetStatus: '已确认',
    })
    expect(updated.status).toBe('已确认')
  })
})

describe('模块配置 · B8 与 B10 实现状态', () => {
  it('dashboard 与 alerts 模块在 MODULES 中均被标记为 implemented: true 且角色可见性正确', () => {
    const dashboard = MODULES.find((m) => m.key === 'dashboard')
    const alerts = MODULES.find((m) => m.key === 'alerts')

    expect(dashboard).toBeDefined()
    expect(dashboard?.implemented).toBe(true)
    expect(dashboard?.code).toBe('B8')
    expect([...pageRolesOf(dashboard!)]).toEqual(['admin', 'manager'])

    expect(alerts).toBeDefined()
    expect(alerts?.implemented).toBe(true)
    expect(alerts?.code).toBe('B10')
    expect([...pageRolesOf(alerts!)]).toEqual(['admin', 'manager'])
  })
})
