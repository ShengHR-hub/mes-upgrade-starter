import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { materialRequirementsService } from './material-requirements'
import { qualityAnalysesService } from './quality-analyses'

/**
 * S11 服务层回归（B11 SPC / B12 MRP-lite）。
 *
 * 手法与既有 `s10-services.spec.ts` 一致：替换 axios adapter，走真实拦截器链，
 * 断言路径、方法、参数整理与统一包体拆解符合契约（§6.5 / §6.10）。
 */

type AdapterResult = { status: number; body: unknown }

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
      headers: {},
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

describe('B11 SPC 服务 —— 契约 §6.5', () => {
  it('Pareto：GET /quality-analyses/paretos，日期必填、空筛选项不发送', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { items: [], totalDefectQty: 0 } } }
    await qualityAnalysesService.paretos({
      startDate: '2026-10-09',
      endDate: '2026-10-09',
      prodLine: 'SMT-2线',
      stepName: '',
    })
    expect(adapterCalls[0].method).toBe('GET')
    expect(adapterCalls[0].url).toBe('/quality-analyses/paretos')
    // 空字符串 stepName 被 compactParams 剔除
    expect(adapterCalls[0].params).toEqual({
      startDate: '2026-10-09',
      endDate: '2026-10-09',
      prodLine: 'SMT-2线',
    })
  })

  it('趋势：GET /quality-analyses/trends', async () => {
    await qualityAnalysesService.trends({ startDate: '2026-10-01', endDate: '2026-10-07' })
    expect(adapterCalls[0].url).toBe('/quality-analyses/trends')
  })

  it('良品率：GET /quality-analyses/good-rates', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: { metric: 'reportGoodRate', value: 95, isTrueFpy: false },
      },
    }
    const result = await qualityAnalysesService.goodRates({
      startDate: '2026-10-09',
      endDate: '2026-10-09',
    })
    expect(adapterCalls[0].url).toBe('/quality-analyses/good-rates')
    expect(result.isTrueFpy).toBe(false)
  })

  it('业务失败包体（code != 0）按失败抛出', async () => {
    nextResult = { status: 200, body: { code: 20004, message: '无权限操作', data: null } }
    await expect(
      qualityAnalysesService.paretos({ startDate: '2026-10-09', endDate: '2026-10-09' }),
    ).rejects.toMatchObject({ code: 20004 })
  })
})

describe('B12 MRP-lite 服务 —— 契约 §6.10', () => {
  it('POST /material-requirement-calculations，请求体原样发送', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: {
          orderIds: ['101'],
          items: [
            {
              materialCode: 'MAT-001',
              grossRequiredQty: '200.00',
              inboundQty: 0,
              availableQty: null,
              shortageQty: null,
              purchaseSuggestionQty: null,
            },
          ],
          calculationScope: 'flat-bom-gross-requirements',
          limitations: ['x'],
        },
      },
    }
    const result = await materialRequirementsService.calculate({ orderIds: ['101'] })
    expect(adapterCalls[0].method).toBe('POST')
    expect(adapterCalls[0].url).toBe('/material-requirement-calculations')
    expect(adapterCalls[0].data).toEqual({ orderIds: ['101'] })
    // 契约铁律：三个受限字段恒为 null
    expect(result.items[0].availableQty).toBeNull()
    expect(result.items[0].shortageQty).toBeNull()
    expect(result.items[0].purchaseSuggestionQty).toBeNull()
    // 毛需求是十进制字符串，保持原样
    expect(result.items[0].grossRequiredQty).toBe('200.00')
  })
})
