import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { DailyReportsService } from './daily-reports'
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

describe('DailyReportsService —— 契约 §6.10 (F2 AI生产日报)', () => {
  it('POST /daily-reports 传递 date 请求体并返回日报数据', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          date: '2026-10-10',
          answerStatus: 'answered',
          mode: 'local_rule',
          degraded: false,
          snapshotAt: '2026-10-12T00:00:00.000+08:00',
          dataSource: 'demo_database',
          dataLabel: '演示数据',
          overview: {
            planQty: 1000,
            planTotalQty: 1000,
            doneQty: 950,
            outputQty: 950,
            goodQty: 930,
            badQty: 20,
            completionRate: 95.0,
            goodRate: 97.89,
            isTrueFpy: false,
            text: '2026-10-10 生产达成率 95.00%，整体运行良好。',
          },
          linePerformance: [
            {
              prodLine: 'LINE-1',
              planQty: 500,
              planTotalQty: 500,
              doneQty: 480,
              outputQty: 480,
              goodQty: 470,
              badQty: 10,
              completionRate: 96.0,
              goodRate: 97.92,
            },
          ],
          alerts: [],
          suggestions: [],
        },
      },
    }

    const res = await DailyReportsService.generate({ date: '2026-10-10' })

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/daily-reports')
    expect(adapterCalls[0]?.data).toEqual({ date: '2026-10-10' })
    expect(res.date).toBe('2026-10-10')
    expect(res.overview.planQty).toBe(1000)
    expect(res.overview.completionRate).toBe(95.0)
    expect(res.mode).toBe('local_rule')
    expect(res.degraded).toBe(false)
  })
})

describe('AlertsService —— 契约 §6.10 (F4 预警根因分析)', () => {
  it('POST /alerts/:id/root-cause-analyses 发送根因分析请求并返回分析结果', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          alertId: '42',
          mode: 'local_rule',
          degraded: false,
          analysisStatus: 'hypothesis',
          explanation: '分析结果：产线物料轻微波动。',
          possibleCauses: [
            {
              text: '模具寿命接近上限',
              evidenceRefs: ['ev-01'],
            },
          ],
          suggestion: '安排预防性模具点检',
          snapshotAt: '2026-10-12T00:00:00.000+08:00',
          dataSource: 'demo_database',
          dataLabel: '演示数据',
        },
      },
    }

    const res = await AlertsService.analyzeRootCause('42')

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/alerts/42/root-cause-analyses')
    expect(res.alertId).toBe('42')
    expect(res.analysisStatus).toBe('hypothesis')
    expect(res.possibleCauses).toHaveLength(1)
    expect(res.possibleCauses[0]?.text).toBe('模具寿命接近上限')
  })

  it('POST /alerts/:id/root-cause-analyses 支持传递 AbortSignal 取消在途请求', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(AlertsService.analyzeRootCause('42', controller.signal)).rejects.toBeDefined()
  })
})

describe('模块配置 · F2 与 F4 角色权限与注册状态', () => {
  it('ai-daily-report 模块被标记为 implemented: true 且严格仅 admin 可见', () => {
    const dailyReport = MODULES.find((m) => m.key === 'ai-daily-report')

    expect(dailyReport).toBeDefined()
    expect(dailyReport?.implemented).toBe(true)
    expect(dailyReport?.code).toBe('F2')
    expect(dailyReport?.readPermission).toBe('daily-reports:create')
    expect([...pageRolesOf(dailyReport!)]).toEqual(['admin'])
  })

  it('alerts 模块包含 B10/F4 标识，仅 admin 和 manager 可见', () => {
    const alerts = MODULES.find((m) => m.key === 'alerts')

    expect(alerts).toBeDefined()
    expect(alerts?.implemented).toBe(true)
    expect(alerts?.code).toBe('B10')
    expect([...pageRolesOf(alerts!)]).toEqual(['admin', 'manager'])
  })
})
