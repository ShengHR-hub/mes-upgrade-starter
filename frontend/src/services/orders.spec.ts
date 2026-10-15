import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { ordersService } from './orders'
import { productsService } from './products'
import { workOrdersService } from './work-orders'

/**
 * S5 服务层回归：确认订单 / 工单 / 任务 / 产品四个服务
 * **全部经统一客户端发起**，路径、方法、请求体与参数整理符合契约。
 *
 * 手法与 `http.spec.ts` 一致：替换 axios adapter，走**真实拦截器链**。
 */
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

describe('ordersService —— 契约 §6.2', () => {
  it('列表：GET /orders，空筛选项不发送', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 20 } },
    }
    await ordersService.list({ page: 1, pageSize: 20, status: '', productCode: undefined, keyword: '' })

    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/orders')
    expect(adapterCalls[0]?.params).toEqual({ page: 1, pageSize: 20 })
  })

  it('列表：筛选条件原样传递（含日期区间）', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 2, pageSize: 50 } },
    }
    await ordersService.list({
      page: 2,
      pageSize: 50,
      status: '已完成',
      productCode: 'JC-PLC-2001',
      keyword: 'SO-2026',
      dueDateFrom: '2026-10-01',
      dueDateTo: '2026-10-31',
    })

    expect(adapterCalls[0]?.params).toEqual({
      page: 2,
      pageSize: 50,
      status: '已完成',
      productCode: 'JC-PLC-2001',
      keyword: 'SO-2026',
      dueDateFrom: '2026-10-01',
      dueDateTo: '2026-10-31',
    })
  })

  it('创建：POST /orders，请求体只含契约字段（不含 createdBy / status）', async () => {
    nextResult = {
      status: 201,
      body: { code: 0, message: '成功', data: { id: '101', code: 'SO-1' } },
    }
    const created = await ordersService.create({
      code: 'SO-1',
      productCode: 'JC-PLC-2001',
      qty: 100,
      dueDate: '2026-10-15',
    })

    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/orders')
    expect(adapterCalls[0]?.data).toEqual({
      code: 'SO-1',
      productCode: 'JC-PLC-2001',
      qty: 100,
      dueDate: '2026-10-15',
    })
    expect(created).toEqual({ id: '101', code: 'SO-1' })
  })

  it('修改：PATCH /orders/{id}', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '101' } } }
    await ordersService.update('101', { qty: 120 })

    expect(adapterCalls[0]?.method).toBe('PATCH')
    expect(adapterCalls[0]?.url).toBe('/orders/101')
    expect(adapterCalls[0]?.data).toEqual({ qty: 120 })
  })

  it('确认：POST /orders/{id}/confirmations，仅传 expectedStatus', async () => {
    nextResult = {
      status: 200,
      body: {
        code: 0,
        message: '成功',
        data: { orderId: '101', status: '已确认', workOrders: [{ id: '201', code: 'WO-20261010-001', taskCount: 10 }] },
      },
    }
    const result = await ordersService.confirm('101', '待确认')

    expect(adapterCalls[0]?.method).toBe('POST')
    expect(adapterCalls[0]?.url).toBe('/orders/101/confirmations')
    expect(adapterCalls[0]?.data).toEqual({ expectedStatus: '待确认' })
    expect(result.workOrders).toHaveLength(1)
    expect(result.workOrders[0]?.taskCount).toBe(10)
  })

  it('ID 原样使用字符串（不做 Number 转换）', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '9007199254740993' } } }
    await ordersService.detail('9007199254740993')
    expect(adapterCalls[0]?.url).toBe('/orders/9007199254740993')
  })
})

describe('workOrdersService —— 契约 §6.3', () => {
  it('工单任务列表：GET /work-orders/{id}/tasks', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 100 } },
    }
    await workOrdersService.tasks('201', { page: 1, pageSize: 100, status: '' })

    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/work-orders/201/tasks')
    expect(adapterCalls[0]?.params).toEqual({ page: 1, pageSize: 100 })
  })

  it('工单计划：PATCH /work-orders/{id}（null 表示清空）', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '201' } } }
    await workOrdersService.updatePlan('201', { planStart: '2026-10-10', planEnd: null })

    expect(adapterCalls[0]?.method).toBe('PATCH')
    expect(adapterCalls[0]?.url).toBe('/work-orders/201')
    expect(adapterCalls[0]?.data).toEqual({ planStart: '2026-10-10', planEnd: null })
  })

  it('工单状态流转：POST /work-orders/{id}/state-transitions', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '201', status: '在产' } } }
    await workOrdersService.transitionWorkOrder('201', { expectedStatus: '待启动', targetStatus: '在产' })

    expect(adapterCalls[0]?.url).toBe('/work-orders/201/state-transitions')
    expect(adapterCalls[0]?.data).toEqual({ expectedStatus: '待启动', targetStatus: '在产' })
  })

  it('任务详情与流转：/tasks/{id}', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '301' } } }
    await workOrdersService.taskDetail('301')
    await workOrdersService.transitionTask('301', { expectedStatus: '待启动', targetStatus: '在产' })

    expect(adapterCalls[0]?.url).toBe('/tasks/301')
    expect(adapterCalls[1]?.url).toBe('/tasks/301/state-transitions')
  })

  it('任务计划：PATCH /tasks/{id}，DATETIME 为 RFC 3339 字符串', async () => {
    nextResult = { status: 200, body: { code: 0, message: '成功', data: { id: '301' } } }
    await workOrdersService.updateTask('301', { planStart: '2026-10-10T08:00:00+08:00' })

    expect(adapterCalls[0]?.method).toBe('PATCH')
    expect(adapterCalls[0]?.data).toEqual({ planStart: '2026-10-10T08:00:00+08:00' })
  })

  it('写请求失败只发起一次（不自动重试）', async () => {
    nextResult = { status: 409, body: { code: 30002, message: '资源冲突', data: null } }
    await expect(
      workOrdersService.transitionWorkOrder('201', { expectedStatus: '待启动', targetStatus: '在产' }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 30002 })
    expect(adapterCalls).toHaveLength(1)
  })

  it('422 / 30006（Q2 未决的流转）按业务失败透出，不重试', async () => {
    nextResult = {
      status: 422,
      body: { code: 30006, message: '工单「待启动」→「暂停」涉及暂停/恢复/关闭，其流转规则尚未确认', data: null },
    }
    await expect(
      workOrdersService.transitionWorkOrder('201', { expectedStatus: '待启动', targetStatus: '暂停' }),
    ).rejects.toMatchObject({ code: 30006 })
    expect(adapterCalls).toHaveLength(1)
  })
})

describe('productsService —— 契约 §6.6（S5 最小只读）', () => {
  it('GET /products，关键字与产品线可选', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 100 } },
    }
    await productsService.list({ page: 1, pageSize: 100, keyword: 'PLC', line: '' })

    expect(adapterCalls[0]?.method).toBe('GET')
    expect(adapterCalls[0]?.url).toBe('/products')
    expect(adapterCalls[0]?.params).toEqual({ page: 1, pageSize: 100, keyword: 'PLC' })
  })
})
