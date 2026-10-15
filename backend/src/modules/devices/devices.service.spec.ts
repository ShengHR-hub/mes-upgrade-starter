import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { DevicesService, ALLOWED_DEVICE_TRANSITIONS } from './devices.service.js';

/**
 * B7 设备服务测试（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九.4：expectedStatus 冲突（30003）、Q3 未批准时任何流转
 * 一律 30006 且**不产生任何写入**、OEE 缺输入返回 null +
 * insufficient_data + missingInputs。
 */

function makeHarness(options: {
  query?: (sql: string) => Promise<unknown>;
}): { service: DevicesService; writes: string[] } {
  const writes: string[] = [];
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({
        query: async (sql: string) => {
          if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
          return options.query ? options.query(sql) : [];
        },
      }),
    query: async (sql: string) => {
      if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
      return options.query ? options.query(sql) : [];
    },
  };
  return { service: new DevicesService(dataSource as never), writes };
}

describe('Q3 门禁：允许流转表必须为空（未批准不开放）', () => {
  it('ALLOWED_DEVICE_TRANSITIONS 当前没有任何条目', () => {
    expect(Object.keys(ALLOWED_DEVICE_TRANSITIONS)).toHaveLength(0);
  });
});

describe('DevicesService.transition —— 写入入口保持关闭', () => {
  it('expectedStatus 与当前状态不一致 → 30003（并发冲突不覆盖新状态）', async () => {
    const { service, writes } = makeHarness({
      query: async (sql) =>
        sql.includes('FROM device WHERE code') ? [{ code: 'EQP-SMT-006', status: '维修中' }] : [],
    });
    await expect(
      service.transition('EQP-SMT-006', '运行中', '停机'),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE_TRANSITION });
    expect(writes).toHaveLength(0);
  });

  it('设备不存在 → 30001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(
      service.transition('NOPE', '运行中', '停机'),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
  });

  it('Q3 未批准：expectedStatus 匹配的合法请求也一律 30006，且零写入', async () => {
    const { service, writes } = makeHarness({
      query: async (sql) =>
        sql.includes('FROM device WHERE code') ? [{ code: 'EQP-SMT-006', status: '维修中' }] : [],
    });
    await expect(
      service.transition('EQP-SMT-006', '维修中', '待机'),
    ).rejects.toMatchObject({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    // 不写 device、不写 equipment_log、不写任何自动停机告警
    expect(writes).toHaveLength(0);
  });

  it('targetStatus 非法枚举 → 10001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(
      service.transition('EQP-SMT-006', '维修中', '炸了'),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });
});

describe('DevicesService.oee —— 缺输入不给数字', () => {
  it('返回 null + insufficient_data + missingInputs（三项实际缺失）', async () => {
    const { service } = makeHarness({
      query: async (sql) =>
        sql.includes('FROM device WHERE code') ? [{ code: 'EQP-SMT-006' }] : [],
    });
    const oee = await service.oee('EQP-SMT-006');
    expect(oee).toMatchObject({
      deviceCode: 'EQP-SMT-006',
      availability: null,
      performance: null,
      quality: null,
      oee: null,
      calculationStatus: 'insufficient_data',
    });
    expect(oee.missingInputs).toEqual(['计划生产时间', '设备产出归属', '理想节拍']);
    expect(oee.dataSource).toBe('demo');
  });

  it('设备不存在 → 30001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(service.oee('NOPE')).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });
});

describe('DevicesService 列表/日志边界', () => {
  it('非法 status 枚举 → 10001', async () => {
    const { service } = makeHarness({ query: async () => [{ total: '0' }] });
    await expect(
      service.list({ status: '炸了' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('状态日志非法日期 → 10001（先查设备存在性）', async () => {
    const { service } = makeHarness({
      query: async (sql) =>
        sql.includes('FROM device WHERE code') ? [{ code: 'EQP-SMT-006' }] : [],
    });
    await expect(
      service.listStateLogs('EQP-SMT-006', { startDate: '2026-02-31' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('状态日志对不存在设备 → 30001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(
      service.listStateLogs('NOPE', {}),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
  });
});
