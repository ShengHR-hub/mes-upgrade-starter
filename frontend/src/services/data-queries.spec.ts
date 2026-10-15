import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { DataQueriesService } from './data-queries'
import { MODULES, pageRolesOf } from '@/config/modules'

type AdapterResult = { status: number; body: unknown; headers?: Record<string, string> }

let adapterCalls: Array<{ method: string; url: string; params: unknown; data: unknown }>
let nextResult: AdapterResult

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

describe('DataQueriesService —— 契约 §7.1 (F3 智能问数)', () => {
  it('POST /data-queries 传递 question 请求体并返回问数结果', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          answerStatus: 'answered',
          answer: '查询结果：产线 SMT-3 报工良品率 95%，为所查询范围最低。',
          clarification: null,
          query: {
            metric: 'goodRate',
            groupBy: 'prodLine',
            operation: 'minimum',
            startDate: '2026-10-13',
            endDate: '2026-10-13',
            prodLine: null,
          },
          columns: [
            { key: 'prodLine', label: '产线', type: 'string' },
            { key: 'goodRate', label: '报工良品率', type: 'number', unit: '%' },
          ],
          rows: [
            { prodLine: 'SMT-3', goodRate: 95, dataStatus: 'available' },
            { prodLine: 'SMT-1', goodRate: 97.14, dataStatus: 'available' },
          ],
          sources: [
            {
              resource: 'reports',
              filters: {
                startDate: '2026-10-13',
                endDate: '2026-10-13',
                finalTasksOnly: true,
              },
            },
          ],
          mode: 'local',
          degraded: false,
          snapshotAt: '2026-10-13T09:00:00+08:00',
          dataSource: 'demo',
          dataLabel: '演示数据',
        },
      },
    }

    const res = await DataQueriesService.query({ question: '今天哪条产线直通率最低？' })

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/data-queries')
    expect(adapterCalls[0]?.data).toEqual({ question: '今天哪条产线直通率最低？' })
    expect(res.answerStatus).toBe('answered')
    expect(res.query?.metric).toBe('goodRate')
    expect(res.rows).toHaveLength(2)
    expect(res.dataLabel).toBe('演示数据')
  })

  it('澄清与无数据状态按契约透传（HTTP 200 / code 0）', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          answerStatus: 'clarification_required',
          answer: '无法从问题中确定统计时间范围，请明确日期或时间区间。',
          clarification: '无法从问题中确定统计时间范围，请明确日期或时间区间。',
          query: null,
          columns: [],
          rows: [],
          sources: [],
          mode: 'local',
          degraded: false,
          snapshotAt: '2026-10-13T09:00:00+08:00',
          dataSource: 'demo',
          dataLabel: '演示数据',
        },
      },
    }

    const res = await DataQueriesService.query({ question: '上个月哪天产量最高' })
    expect(res.answerStatus).toBe('clarification_required')
    expect(res.clarification).toContain('时间范围')
  })

  it('支持传递 AbortSignal 取消在途请求', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      DataQueriesService.query({ question: '今天产量' }, controller.signal),
    ).rejects.toBeDefined()
  })

  it('可选显式参数（日期范围 / 产线）一并传入请求体', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { answerStatus: 'no_data' } },
    }

    await DataQueriesService.query({
      question: '各产线良品数',
      startDate: '2026-10-08',
      endDate: '2026-10-13',
      prodLine: 'SMT-2',
    })

    expect(adapterCalls[0]?.data).toEqual({
      question: '各产线良品数',
      startDate: '2026-10-08',
      endDate: '2026-10-13',
      prodLine: 'SMT-2',
    })
  })
})

describe('模块配置 · F3 角色权限与注册状态', () => {
  it('ai-data-query 模块被标记为 implemented: true，admin / manager 可见', () => {
    const dataQuery = MODULES.find((m) => m.key === 'ai-data-query')

    expect(dataQuery).toBeDefined()
    expect(dataQuery?.implemented).toBe(true)
    expect(dataQuery?.code).toBe('F3')
    expect(dataQuery?.readPermission).toBe('data-queries:create')
    expect(dataQuery?.path).toBe('/ai/data-query')
    expect([...pageRolesOf(dataQuery!)]).toEqual(['admin', 'manager'])
  })
})
