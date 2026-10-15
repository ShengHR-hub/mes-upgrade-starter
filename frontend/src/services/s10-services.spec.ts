import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { bomsService, materialBatchesService, materialsService } from './materials'
import { snTracesService } from './sn-traces'
import { devicesService } from './devices'
import { accountService, logsService, usersService } from './users'

/**
 * S10 服务层回归（B5 物料 / B6 SN 追溯 / B7 设备 / B9 用户与审计）。
 *
 * 目的：确认所有新增服务**经统一客户端发起**，路径、方法、请求体与参数整理符合契约。
 * 手法与既有 `orders.spec.ts` 一致：替换 axios adapter，走**真实拦截器链**。
 */
type AdapterResult = { status: number; body: unknown; headers?: Record<string, string> }

let adapterCalls: Array<{ method: string; url: string; params: unknown; data: unknown; auth: string | null }> = []
let nextResult: AdapterResult = { status: 200, body: { code: 0, message: '成功', data: null } }

function installAdapter(): void {
  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const authHeader = config.headers?.get?.('Authorization')
    adapterCalls.push({
      method: String(config.method ?? '').toUpperCase(),
      url: String(config.url ?? ''),
      params: config.params,
      data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      auth: typeof authHeader === 'string' ? authHeader : null,
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

function okPage(): AdapterResult {
  return { status: 200, body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 20 } } }
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

describe('B5 物料管理服务 —— 契约 §6.6', () => {
  it('物料列表：GET /materials，空筛选项不发送', async () => {
    nextResult = okPage()
    await materialsService.list({ page: 1, pageSize: 20, keyword: '', category: undefined })
    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/materials')
    expect(adapterCalls[0]?.params).toEqual({ page: 1, pageSize: 20 })
  })

  it('安全库存修改：PATCH /materials/{code}，仅发送 safetyStock', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { code: 'MAT-001' } } }
    await materialsService.updateSafetyStock('MAT-001', 50)
    expect(adapterCalls[0]?.method).toBe('PATCH')
    expect(adapterCalls[0]?.url).toBe('/materials/MAT-001')
    expect(adapterCalls[0]?.data).toEqual({ safetyStock: 50 })
  })

  it('BOM 新增：POST /products/{code}/boms，qty 以十进制字符串传递', async () => {
    nextResult = { status: 201, body: { code: 0, message: '成功', data: { id: '31' } } }
    await bomsService.create('JC-PLC-2001', { materialCode: 'MAT-001', level: 1, qty: '2.00' })
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/products/JC-PLC-2001/boms')
    expect(adapterCalls[0]?.data).toEqual({ materialCode: 'MAT-001', level: 1, qty: '2.00' })
    const sentBody = adapterCalls[0]?.data as { qty?: unknown } | undefined
    // qty 必须是字符串，不能被序列化成数字
    expect(typeof sentBody?.qty).toBe('string')
  })

  it('BOM 修改 / 删除：PATCH /boms/{id}、DELETE /boms/{id}', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '31' } } }
    await bomsService.update('31', { qty: '3.50', unit: null })
    expect(adapterCalls[0]?.method).toBe('PATCH')
    expect(adapterCalls[0]?.url).toBe('/boms/31')
    expect(adapterCalls[0]?.data).toEqual({ qty: '3.50', unit: null })

    await bomsService.remove('31')
    expect(adapterCalls[1]?.method).toBe('DELETE')
    expect(adapterCalls[1]?.url).toBe('/boms/31')
  })

  it('批次入库：POST /material-batches；批次反查：GET /material-batches/{id}/sn-traces', async () => {
    nextResult = { status: 201, body: { code: 0, message: '成功', data: { id: '701' } } }
    await materialBatchesService.create({
      batchNo: 'BATCH-001',
      materialCode: 'MAT-001',
      qty: 100,
      inboundAt: '2026-10-09',
    })
    expect(adapterCalls[0]?.url).toBe('/material-batches')

    nextResult = okPage()
    await materialBatchesService.listSnTraces('701', { page: 1, pageSize: 20 })
    expect(adapterCalls[1]?.url).toBe('/material-batches/701/sn-traces')
  })
})

describe('B6 SN 追溯服务 —— 契约 §6.6', () => {
  it('列表 / 详情：GET /sn-traces、GET /sn-traces/{sn}（sn 精确、URL 编码）', async () => {
    nextResult = okPage()
    await snTracesService.list({ page: 1, pageSize: 20, sn: 'DEMO SN/001' })
    expect(adapterCalls[0]?.url).toBe('/sn-traces')
    expect(adapterCalls[0]?.params).toEqual({ page: 1, pageSize: 20, sn: 'DEMO SN/001' })

    nextResult = { status: 200, body: { code: 0, message: '成功', data: { sn: 'DEMO-SN-001' } } }
    await snTracesService.detail('DEMO-SN-001')
    expect(adapterCalls[1]?.url).toBe('/sn-traces/DEMO-SN-001')
  })

  it('创建 / 快照更新：POST /sn-traces、PATCH /sn-traces/{sn}（不发送 producedAt）', async () => {
    nextResult = { status: 201, body: { code: 0, message: '成功', data: { sn: 'DEMO-SN-001' } } }
    await snTracesService.create({ sn: 'DEMO-SN-001', workOrderId: '401' })
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/sn-traces')

    nextResult = { status: 200, body: { code: 0, message: '成功', data: { sn: 'DEMO-SN-001' } } }
    await snTracesService.update('DEMO-SN-001', { deviceCode: 'EQP-SMT-002' })
    expect(adapterCalls[1]?.method).toBe('PATCH')
    expect(adapterCalls[1]?.url).toBe('/sn-traces/DEMO-SN-001')
    expect(adapterCalls[1]?.data).toEqual({ deviceCode: 'EQP-SMT-002' })
    expect(adapterCalls[1]?.data).not.toHaveProperty('producedAt')
  })

  it('JSON 导出：POST /sn-traces/{sn}/exports，format=json', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { fileName: 'sn.json', content: '{}', format: 'json' } },
    }
    await snTracesService.export('DEMO-SN-001')
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/sn-traces/DEMO-SN-001/exports')
    expect(adapterCalls[0]?.data).toEqual({ format: 'json' })
  })
})

describe('B7 设备管理服务 —— 契约 §6.7', () => {
  it('列表 / 详情 / 状态日志 / OEE 路径正确', async () => {
    nextResult = okPage()
    await devicesService.list({ page: 1, pageSize: 50, keyword: '', status: '' })
    expect(adapterCalls[0]?.url).toBe('/devices')
    expect(adapterCalls[0]?.params).toEqual({ page: 1, pageSize: 50 })

    nextResult = { status: 200, body: { code: 0, message: '成功', data: { code: 'EQP-SMT-006' } } }
    await devicesService.detail('EQP-SMT-006')
    expect(adapterCalls[1]?.url).toBe('/devices/EQP-SMT-006')

    nextResult = okPage()
    await devicesService.listStateLogs('EQP-SMT-006', { startDate: '2026-10-01', endDate: '2026-10-31' })
    expect(adapterCalls[2]?.url).toBe('/devices/EQP-SMT-006/state-logs')

    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: { code: 'EQP-SMT-006', calculationStatus: 'insufficient_data', oee: null, missingInputs: ['计划生产时间'] },
      },
    }
    const oee = await devicesService.oee('EQP-SMT-006')
    expect(adapterCalls[3]?.url).toBe('/devices/EQP-SMT-006/oee-analyses')
    expect(oee.oee).toBeNull()
    expect(oee.calculationStatus).toBe('insufficient_data')
  })

  it('状态迁移：POST /devices/{code}/state-transitions，原样发送 expectedStatus', async () => {
    nextResult = { status: 200, body: { code: 30006, message: '功能未启用', data: null } }
    await expect(
      devicesService.transition('EQP-SMT-006', { expectedStatus: '维修中', targetStatus: '运行中' }),
    ).rejects.toMatchObject({ code: 30006 })
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/devices/EQP-SMT-006/state-transitions')
    expect(adapterCalls[0]?.data).toEqual({ expectedStatus: '维修中', targetStatus: '运行中' })
  })
})

describe('B9 用户与审计服务 —— 契约 §5.3', () => {
  it('用户列表 / 新建 / 修改路径正确', async () => {
    nextResult = okPage()
    await usersService.list({ page: 1, pageSize: 50, keyword: '', role: undefined, enabled: undefined })
    expect(adapterCalls[0]?.url).toBe('/users')

    nextResult = { status: 201, body: { code: 0, message: '成功', data: { id: '9' } } }
    await usersService.create({ username: 'u1', name: '甲', password: 'p', role: 'operator' })
    expect(adapterCalls[1]?.method).toBe('POST')
    expect(adapterCalls[1]?.url).toBe('/users')

    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '9' } } }
    await usersService.update('9', { role: 'manager', enabled: false })
    expect(adapterCalls[2]?.method).toBe('PATCH')
    expect(adapterCalls[2]?.url).toBe('/users/9')
  })

  it('日志只读查询：GET /audit-logs、GET /ai-query-logs；权限清单 GET /role-permissions', async () => {
    nextResult = okPage()
    await logsService.auditLogs({ page: 1, pageSize: 50, action: '' })
    expect(adapterCalls[0]?.url).toBe('/audit-logs')

    await logsService.aiQueryLogs({ page: 1, pageSize: 50 })
    expect(adapterCalls[1]?.url).toBe('/ai-query-logs')

    nextResult = { status: 200, body: { code: 0, message: '成功', data: { roles: [] } } }
    await logsService.rolePermissions()
    expect(adapterCalls[2]?.url).toBe('/role-permissions')
  })

  it('登录 / 当前用户 / 改密路径正确', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { accessToken: 'x', tokenType: 'Bearer', expiresAt: '', user: {} } },
    }
    await accountService.login({ username: 'u1', password: 'p' })
    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/sessions')

    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '1' } } }
    await accountService.me()
    expect(adapterCalls[1]?.url).toBe('/users/me')

    nextResult = { status: 200, body: { code: 0, message: '成功', data: null } }
    await accountService.changePassword({ oldPassword: 'a', newPassword: 'b' })
    expect(adapterCalls[2]?.method).toBe('POST')
    expect(adapterCalls[2]?.url).toBe('/users/me/password-changes')
  })

  it('令牌由拦截器注入 Authorization（仅在内存提供者返回令牌时）', async () => {
    setAccessTokenProvider(() => 'memory-token')
    nextResult = okPage()
    await usersService.list({ page: 1, pageSize: 20 })
    expect(adapterCalls[0]?.auth).toBe('Bearer memory-token')
  })
})
