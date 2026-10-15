import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { MaterialBatchesService } from './material-batches.service.js';

/**
 * B5 物料批次服务测试（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九.2：批次唯一性（30002）、非法日期（10001）、
 * 关联物料不存在（10002）、并发唯一键冲突（1062 → 30002）、
 * 批次反查批次不存在（30001）。
 */

const CREATE_DTO = {
  batchNo: 'DEMO-BATCH-001',
  materialCode: 'MAT-001',
  qty: 100,
  inboundAt: '2026-10-09',
};
const CONTEXT = { userId: '2', ip: '127.0.0.1' };

const BATCH_ROW = {
  id: '701',
  batch_no: 'DEMO-BATCH-001',
  material_code: 'MAT-001',
  qty: 100,
  inbound_at: '2026-10-09',
  supplier: null,
};

function makeHarness(query: (sql: string) => Promise<unknown>): {
  service: MaterialBatchesService;
  audit: { write: ReturnType<typeof vi.fn> };
} {
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({ query: async (sql: string) => query(sql) }),
    query: async (sql: string) => query(sql),
  };
  const audit = { write: vi.fn(async () => undefined) };
  return { service: new MaterialBatchesService(dataSource as never, audit as never), audit };
}

describe('MaterialBatchesService.create', () => {
  it('物料不存在 → 10002', async () => {
    const { service } = makeHarness(async (sql) =>
      sql.includes('FROM material') ? [] : [{ insertId: '701' }],
    );
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_REFERENCE,
    });
  });

  it('非法入库日期（2026-02-31）→ 10001（先于任何写入）', async () => {
    const { service } = makeHarness(async () => []);
    await expect(
      service.create({ ...CREATE_DTO, inboundAt: '2026-02-31' }, CONTEXT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('批次号重复（预检命中）→ 30002', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
      if (sql.includes('material_batch WHERE batch_no')) return [{ id: '700' }];
      return [];
    });
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('并发唯一键冲突（1062）→ 30002，不透传 500', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('material_batch WHERE batch_no')) return [];
      if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
      if (sql.startsWith('INSERT INTO material_batch')) {
        throw Object.assign(new Error("Duplicate entry 'DEMO-BATCH-001'"), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        });
      }
      return [];
    });
    await expect(service.create(CREATE_DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('成功：插入 + 审计同事务，qty 仅称入库数量', async () => {
    const { service, audit } = makeHarness(async (sql) => {
      // 注意匹配顺序：批次预检与插入后回读必须早于「FROM material」泛匹配
      // （'FROM material_batch' 包含子串 'FROM material'）
      if (sql.includes('material_batch WHERE batch_no')) return [];
      if (sql.includes('FROM material_batch mb WHERE mb.id')) return [BATCH_ROW];
      if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
      if (sql.startsWith('INSERT INTO material_batch')) return { insertId: '701' };
      return [BATCH_ROW];
    });
    const result = await service.create(CREATE_DTO, CONTEXT);
    expect(result).toMatchObject({ id: '701', batchNo: 'DEMO-BATCH-001', qty: 100 });
    expect(result.dataSource).toBe('demo');
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
});

describe('MaterialBatchesService.listSnTraces', () => {
  it('批次不存在 → 30001', async () => {
    const { service } = makeHarness(async () => []);
    await expect(
      service.listSnTraces('701', {}),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
  });

  it('批次存在 → 返回该批次绑定的 SN 列表（精确批次匹配）', async () => {
    const { service } = makeHarness(async (sql) => {
      if (sql.includes('FROM material_batch WHERE id')) return [{ id: '701' }];
      if (sql.includes('COUNT(*)')) return [{ total: '1' }];
      if (sql.includes('FROM sn_trace')) {
        return [
          {
            id: '901',
            sn: 'DEMO-SN-001',
            work_order_id: '201',
            product_code: 'JC-PLC-2001',
            task_id: null,
            operator_id: '2',
            device_code: null,
            batch_id: '701',
            qc_result: 'OK',
            produced_at: new Date('2026-10-09T01:00:00Z'),
          },
        ];
      }
      return [];
    });
    const page = await service.listSnTraces('701', {});
    expect(page.total).toBe(1);
    expect(page.list[0]).toMatchObject({ sn: 'DEMO-SN-001', batchId: '701' });
  });
});

describe('MaterialBatchesService.list —— 日期过滤', () => {
  it('非法日期 → 10001', async () => {
    const { service } = makeHarness(async () => [{ total: '0' }]);
    await expect(
      service.list({ inboundDateFrom: '2026-13-01' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    await expect(
      service.list({ inboundDateTo: '2026-02-30' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('起始晚于结束 → 10001', async () => {
    const { service } = makeHarness(async () => [{ total: '0' }]);
    await expect(
      service.list({ inboundDateFrom: '2026-10-10', inboundDateTo: '2026-10-09' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('半开区间：结束日转为 < endDate+1 天（防边界漏算）', async () => {
    const sqls: string[] = [];
    const { service } = makeHarness(async (sql) => {
      sqls.push(sql);
      if (sql.includes('COUNT(*)')) return [{ total: '0' }];
      return [];
    });
    await service.list({ inboundDateFrom: '2026-10-01', inboundDateTo: '2026-10-09' });
    const filtered = sqls.find((sql) => sql.includes('inbound_at < ?'));
    expect(filtered).toBeTruthy();
  });
});
