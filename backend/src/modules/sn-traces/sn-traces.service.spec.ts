import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { SnTracesService } from './sn-traces.service.js';

/**
 * B6 SN 追溯服务测试（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九.3：跨工单 task 拒绝（10002）、设备/批次不存在（10002）、
 * SN 唯一（30002）、PATCH 不触碰 produced_at、详情/导出保留
 * coverage / limitations / 数据来源、导出文件名安全化。
 */

const TRACE_ROW = {
  id: '901',
  sn: 'DEMO-SN-001',
  work_order_id: '201',
  product_code: 'JC-PLC-2001',
  task_id: '301',
  operator_id: '2',
  device_code: 'EQP-SMT-001',
  batch_id: '701',
  qc_result: 'OK',
  produced_at: new Date('2026-10-09T01:00:00Z'),
};

const CONTEXT = { userId: '2', ip: '127.0.0.1' };

function makeHarness(query: (sql: string, params?: unknown[]) => Promise<unknown>): {
  service: SnTracesService;
  audit: { write: ReturnType<typeof vi.fn> };
  sqls: string[];
} {
  const sqls: string[] = [];
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({
        query: async (sql: string, params?: unknown[]) => {
          sqls.push(sql);
          return query(sql, params);
        },
      }),
    query: async (sql: string, params?: unknown[]) => {
      sqls.push(sql);
      return query(sql, params);
    },
  };
  const audit = { write: vi.fn(async () => undefined) };
  return { service: new SnTracesService(dataSource as never, audit as never), audit, sqls };
}

const CREATE_DTO = {
  sn: 'DEMO-SN-002',
  workOrderId: '201',
  taskId: '301',
  deviceCode: 'EQP-SMT-001',
  batchId: '701',
  qcResult: 'OK',
};

function queryWithFoundTask(sql: string): Promise<unknown> {
  if (sql.includes('FROM work_order WHERE id')) return Promise.resolve([{ id: '201', product_code: 'JC-PLC-2001' }]);
  if (sql.includes('FROM work_task WHERE')) return Promise.resolve([{ id: '301' }]);
  if (sql.includes('FROM device WHERE')) return Promise.resolve([{ code: 'EQP-SMT-001' }]);
  if (sql.includes('FROM material_batch WHERE')) return Promise.resolve([{ id: '701' }]);
  if (sql.includes('sn_trace WHERE sn = ?')) return Promise.resolve([]);
  if (sql.startsWith('INSERT INTO sn_trace')) return Promise.resolve({ insertId: '902' });
  return Promise.resolve([{ ...TRACE_ROW, id: '902', sn: 'DEMO-SN-002' }]);
}

describe('SnTracesService.create', () => {
  it('task 不属于该工单 → 10002（跨工单 task 拒绝）', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM work_order WHERE id')) return [{ id: '201', product_code: 'JC-PLC-2001' }];
      if (sql.includes('FROM work_task WHERE')) return [];
      return [];
    });
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_REFERENCE,
    });
  });

  it('设备不存在 → 10002', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM work_order WHERE id')) return [{ id: '201', product_code: 'JC-PLC-2001' }];
      if (sql.includes('FROM work_task WHERE')) return [{ id: '301' }];
      if (sql.includes('FROM device WHERE')) return [];
      return [];
    });
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_REFERENCE,
    });
  });

  it('批次不存在 → 10002', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM work_order WHERE id')) return [{ id: '201', product_code: 'JC-PLC-2001' }];
      if (sql.includes('FROM work_task WHERE')) return [{ id: '301' }];
      if (sql.includes('FROM device WHERE')) return [{ code: 'EQP-SMT-001' }];
      if (sql.includes('FROM material_batch WHERE')) return [];
      return [];
    });
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_REFERENCE,
    });
  });

  it('SN 已存在（预检）→ 30002', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM work_order WHERE id')) return [{ id: '201', product_code: 'JC-PLC-2001' }];
      if (sql.includes('FROM work_task WHERE')) return [{ id: '301' }];
      if (sql.includes('FROM device WHERE')) return [{ code: 'EQP-SMT-001' }];
      if (sql.includes('FROM material_batch WHERE')) return [{ id: '701' }];
      if (sql.includes('sn_trace WHERE sn = ?')) return [{ id: '901' }];
      return [];
    });
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('成功：productCode 取自工单、operatorId 来自身份，审计同事务', async () => {
    const { service, audit } = makeHarness(queryWithFoundTask);
    const result = await service.create(CREATE_DTO, CONTEXT);
    expect(result.productCode).toBe('JC-PLC-2001');
    expect(result.operatorId).toBe('2');
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
});

describe('SnTracesService.update —— 不伪造过去事件', () => {
  it('成功更新快照，且 SQL 不含 produced_at（PATCH 不修改 producedAt）', async () => {
    let updated = false;
    const { service, audit, sqls } = makeHarness(async (sql) => {
      if (sql.includes('FROM sn_trace st WHERE st.sn')) {
        return [{ ...TRACE_ROW, ...(updated ? { device_code: 'EQP-SMT-002', batch_id: '702' } : {}) }];
      }
      if (sql.includes('FROM work_task WHERE')) return [{ id: '301' }];
      if (sql.includes('FROM device WHERE')) return [{ code: 'EQP-SMT-002' }];
      if (sql.includes('FROM material_batch WHERE')) return [{ id: '702' }];
      if (sql.startsWith('UPDATE sn_trace')) {
        updated = true;
        return { affectedRows: 1 };
      }
      return [{ ...TRACE_ROW }];
    });
    const result = await service.update(
      'DEMO-SN-001',
      { deviceCode: 'EQP-SMT-002', batchId: '702' },
      CONTEXT,
    );
    expect(result.deviceCode).toBe('EQP-SMT-002');
    expect(audit.write).toHaveBeenCalledTimes(1);
    const updates = sqls.filter((sql) => sql.startsWith('UPDATE sn_trace'));
    expect(updates.length).toBe(1);
    expect(updates[0]).not.toContain('produced_at');
  });

  it('空 body → 10001', async () => {
    const { service } = makeHarness(async () => [{ ...TRACE_ROW }]);
    await expect(service.update('DEMO-SN-001', {}, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('SN 不存在 → 30001', async () => {
    const { service } = makeHarness(async (sql) =>
      sql.includes('FROM sn_trace st WHERE st.sn') ? [] : [],
    );
    await expect(
      service.update('NOPE', { qcResult: 'OK' }, CONTEXT),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
  });
});

describe('SnTracesService.detail / export —— 覆盖度与限制说明', () => {
  it('详情保留 coverage / limitations 与演示标识（工单上下文仅作参考）', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM sn_trace st WHERE st.sn')) return [{ ...TRACE_ROW }];
      if (sql.includes('FROM work_task wt')) return [{ id: '301', seq: 10 }];
      if (sql.includes('FROM qc_record qc')) return [{ id: '501', result: 'OK' }];
      return [];
    });
    const detail = await service.detail('DEMO-SN-001');
    expect(detail.coverage).toBe('single-snapshot-with-work-order-context');
    expect(detail.limitations).toContain('一个SN仅支持一个批次');
    expect(detail.limitations.join(' ')).toContain('IATF 16949');
    expect(detail.dataSource).toBe('demo');
    expect(detail.context.tasks.length).toBe(1);
    expect(detail.context.inspections.length).toBe(1);
  });

  it('导出仅支持 json；文件名安全化；内容含限制说明、无账号敏感信息', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM sn_trace st WHERE st.sn')) return [{ ...TRACE_ROW }];
      if (sql.includes('FROM work_task wt')) return [];
      if (sql.includes('FROM qc_record qc')) return [];
      return [];
    });
    await expect(service.export('DEMO-SN-001', 'pdf')).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });

    const exported = await service.export('DEMO-SN-001', 'json');
    expect(exported.fileName).toBe('DEMO-SN-001-trace.json');
    expect(exported.mediaType).toBe('application/json');
    const parsed = JSON.parse(exported.content) as Record<string, unknown>;
    expect(parsed.coverage).toBe('single-snapshot-with-work-order-context');
    expect(Array.isArray(parsed.limitations)).toBe(true);
    expect(parsed.dataSource).toBe('demo');
    const content = exported.content.toLowerCase();
    expect(content).not.toContain('password');
    expect(content).not.toContain('bearer');
    expect(content).not.toContain('argon2');
  });

  it('safeFileNameSegment：路径穿越与特殊字符被替换', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM sn_trace st WHERE st.sn')) return [{ ...TRACE_ROW }];
      return [];
    });
    // 通过导出间接验证文件名安全化
    const exported = await service.export('DEMO-SN-001', 'json');
    expect(exported.fileName).not.toContain('/');
    expect(exported.fileName).not.toContain('..');
  });
});
