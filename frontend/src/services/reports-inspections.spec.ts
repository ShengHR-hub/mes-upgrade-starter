import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { httpClient, setAccessTokenProvider, setUnauthorizedHandler } from './http'
import { ReportsService } from './reports'
import { QualityInspectionsService } from './quality-inspections'
import { useSubmitGuard } from '@/composables/useSubmitGuard'

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

describe('ReportsService —— 契约 §6.4', () => {
  it('列表：GET /reports，参数直接展开传递（绝不嵌套为 { params: query }）', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 20 } },
    }

    await ReportsService.list({
      page: 1,
      pageSize: 20,
      taskId: '301',
      workOrderId: '201',
      startDate: '2026-10-09',
      endDate: '2026-10-09',
    })

    expect(adapterCalls).toHaveLength(1);
    expect(adapterCalls[0]?.method).toBe('GET');
    expect(adapterCalls[0]?.url).toBe('/reports');
    // 核心回归（P2）：params 不得被嵌套进 { params: ... }
    expect(adapterCalls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      taskId: '301',
      workOrderId: '201',
      startDate: '2026-10-09',
      endDate: '2026-10-09',
    });
    expect(adapterCalls[0]?.params).not.toHaveProperty('params');
  });

  it('创建：POST /reports，请求体正确发送', async () => {
    nextResult = {
      status: 201,
      body: {
        code: 0,
        message: '成功',
        data: {
          report: { id: '401', taskId: '301', userId: '2', goodQty: 76, badQty: 4, reportedAt: '2026-10-09T08:30:00+08:00' },
          taskTotals: { goodQty: 76, badQty: 4 },
          workOrderTotals: { doneQty: 76 },
        },
      },
    };

    const res = await ReportsService.create({
      taskId: '301',
      goodQty: 76,
      badQty: 4,
    });

    expect(adapterCalls[0]?.method).toBe('POST');
    expect(adapterCalls[0]?.url).toBe('/reports');
    expect(adapterCalls[0]?.data).toEqual({
      taskId: '301',
      goodQty: 76,
      badQty: 4,
    });
    expect(res.report.id).toBe('401');
  });
});

describe('QualityInspectionsService —— 契约 §6.5', () => {
  it('列表：GET /quality-inspections，参数直接展开传递（不嵌套 params）', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 20 } },
    };

    await QualityInspectionsService.list({
      page: 1,
      pageSize: 20,
      workOrderId: '201',
      result: 'NG',
    });

    expect(adapterCalls).toHaveLength(1);
    expect(adapterCalls[0]?.method).toBe('GET');
    expect(adapterCalls[0]?.url).toBe('/quality-inspections');
    expect(adapterCalls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      workOrderId: '201',
      result: 'NG',
    });
    expect(adapterCalls[0]?.params).not.toHaveProperty('params');
  });

  it('详情：GET /quality-inspections/{id}，路径编码转义', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { id: '501', result: 'OK' } },
    };

    await QualityInspectionsService.findOne('501');
    expect(adapterCalls[0]?.method).toBe('GET');
    expect(adapterCalls[0]?.url).toBe('/quality-inspections/501');
  });

  it('创建 NG 质检：POST /quality-inspections 携带不良品明细列表', async () => {
    nextResult = {
      status: 201,
      body: { code: 0, message: '成功', data: { id: '501', result: 'NG' } },
    };

    const payload = {
      workOrderId: '201',
      taskId: '301',
      result: 'NG' as const,
      checkQty: 80,
      ngQty: 4,
      remark: '虚焊不良',
      defects: [{ defectType: '虚焊', qty: 4, description: '引脚虚焊' }],
    };

    await QualityInspectionsService.create(payload);
    expect(adapterCalls[0]?.method).toBe('POST');
    expect(adapterCalls[0]?.url).toBe('/quality-inspections');
    expect(adapterCalls[0]?.data).toEqual(payload);
  });

  it('不良列表：GET /defects，参数扁平展开', async () => {
    nextResult = {
      status: 200,
      body: { code: 0, message: '成功', data: { list: [], total: 0, page: 1, pageSize: 20 } },
    };

    await QualityInspectionsService.listDefects({
      page: 1,
      pageSize: 20,
      defectType: '虚焊',
    });

    expect(adapterCalls[0]?.method).toBe('GET');
    expect(adapterCalls[0]?.url).toBe('/defects');
    expect(adapterCalls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      defectType: '虚焊',
    });
  });
});

describe('防重复提交守卫回归（useSubmitGuard）', () => {
  it('并发双击调用只执行一次写请求（在任何 await 之前同步锁定）', async () => {
    const { submitting, run } = useSubmitGuard();
    let executedCount = 0;

    const task = async () => {
      executedCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'done';
    };

    // 模拟连续双击（同步触发）
    const p1 = run(task);
    const p2 = run(task);

    expect(submitting.value).toBe(true);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('done');
    expect(r2).toBeUndefined(); // 第二次被拦截
    expect(executedCount).toBe(1); // 仅执行一次
    expect(submitting.value).toBe(false);
  });
});
