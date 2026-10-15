import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { BomsService } from './boms.service.js';

/**
 * B5 BOM 服务测试（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九.1：BOM 重复（30002）、引用保护（30004）、
 * 并发唯一键冲突（1062 → 30002）、十进制 qty>0、审计同事务。
 *
 * S10 复审 P2 修复（第二轮）：把「会话级命名锁」改为**持久化产品行锁**
 * （`SELECT code FROM product WHERE code = ? FOR UPDATE`）。
 * 本文件断言：产品行锁是事务内第一条语句、早于引用判定与写入，
 * 且**不再**出现已废弃的 `GET_LOCK` / `RELEASE_LOCK`。
 */

const DTO = {
  materialCode: 'MAT-001',
  level: 1,
  qty: '2.00',
  unit: '只',
};
const CONTEXT = { userId: '1', ip: '127.0.0.1' };

const BOM_ROW = {
  id: '31',
  product_code: 'JC-PLC-2001',
  level: 1,
  material_code: 'MAT-001',
  qty: '2.00',
  unit: '只',
};

/** 产品行锁语句识别（锁定读） */
const isProductLock = (sql: string): boolean =>
  sql.includes('FROM product') && sql.includes('FOR UPDATE');
/** 事务外定位 product_code 的查询 */
const isLocate = (sql: string): boolean => sql.includes('product_code FROM bom WHERE id');
/** 读取 BOM 行（含 FOR UPDATE 与回读） */
const isBomRowRead = (sql: string): boolean => sql.includes('FROM bom b WHERE b.id');

function makeHarness(options: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  audit?: { write: (...args: unknown[]) => Promise<unknown> };
}): { service: BomsService; queries: string[] } {
  const queries: string[] = [];
  const run = async (sql: string, params?: unknown[]): Promise<unknown> => {
    queries.push(sql);
    return options.query(sql, params);
  };
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<unknown>) => work({ query: run }),
    query: run,
  };
  const audit = options.audit ?? { write: vi.fn(async () => undefined) };
  return { service: new BomsService(dataSource as never, audit as never), queries };
}

describe('BomsService.create', () => {
  it('产品不存在 → 30001（产品行锁即存在性校验）', async () => {
    const { service } = makeHarness({
      query: async (sql) => (isProductLock(sql) ? [] : [{ id: '1' }]),
    });
    await expect(service.create('NOPE', DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });

  it('物料不存在 → 10002（关联主数据必须真实存在）', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (sql.includes('FROM material')) return [];
        return [];
      },
    });
    await expect(service.create('JC-PLC-2001', DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_REFERENCE,
    });
  });

  it('同一产品/物料重复 → 30002（唯一键语义的服务端预检）', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.includes('FROM bom WHERE')) return [{ id: '31' }];
        return [];
      },
    });
    await expect(service.create('JC-PLC-2001', DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('并发下插入撞唯一键（1062）→ 30002，不透传 500', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
        // 显式声明无已确认业务：新增 BOM 同样受引用保护
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.includes('FROM bom WHERE')) return [];
        if (sql.startsWith('INSERT INTO bom')) {
          throw Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
        return [{ insertId: '31' }];
      },
    });
    await expect(service.create('JC-PLC-2001', DTO, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_CONFLICT,
    });
  });

  it('qty 必须 > 0（"0.00" / 负数字符串均拒绝 → 10001）', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(
      service.create('JC-PLC-2001', { ...DTO, qty: '0.00' }, CONTEXT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    await expect(
      service.create('JC-PLC-2001', { ...DTO, qty: '-1.00' }, CONTEXT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('成功路径：插入 + 审计同一事务（事务内出现 INSERT 与 audit 写入）', async () => {
    const auditWrite = vi.fn(async () => undefined);
    const { service, queries } = makeHarness({
      audit: { write: auditWrite },
      query: async (sql) => {
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.includes('FROM bom WHERE')) return [];
        if (sql.startsWith('INSERT INTO bom')) return { insertId: '31' };
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        return [];
      },
    });

    const result = await service.create('JC-PLC-2001', DTO, CONTEXT);
    expect(result).toMatchObject({ id: '31', qty: '2.00', unit: '只' });
    expect(queries.some((sql) => sql.startsWith('INSERT INTO bom'))).toBe(true);
    expect(auditWrite).toHaveBeenCalledTimes(1);
  });
});

describe('BomsService.update / remove —— 引用保护', () => {
  it('产品已有关联工单 → PATCH 返回 30004（保护在产计算依据）', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        if (sql.includes('FROM work_order')) return [{ id: '201' }];
        if (sql.includes('FROM sale_order')) return [];
        return [];
      },
    });
    await expect(service.update('31', { qty: '3.00' }, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.REFERENCE_IN_USE,
    });
  });

  it('产品已有非待确认订单 → DELETE 返回 30004', async () => {
    const { service } = makeHarness({
      query: async (sql) => {
        if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        if (sql.includes('FROM sale_order')) return [{ id: '101' }];
        return [];
      },
    });
    await expect(service.remove('31', CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.REFERENCE_IN_USE,
    });
  });

  it('被引用保护拒绝时**不执行写入**（事务回滚，无 DELETE/UPDATE）', async () => {
    const { service, queries } = makeHarness({
      query: async (sql) => {
        if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        if (sql.includes('FROM sale_order')) return [{ id: '101' }];
        return [];
      },
    });
    await expect(service.remove('31', CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.REFERENCE_IN_USE,
    });
    expect(queries.some((sql) => sql.startsWith('DELETE FROM bom'))).toBe(false);
  });

  it('无关联业务时 PATCH 成功且写审计', async () => {
    const auditWrite = vi.fn(async () => undefined);
    let updated = false;
    const dataSource = {
      transaction: async (work: (m: unknown) => Promise<unknown>) =>
        work({
          query: async (sql: string) => {
            if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
            if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
            if (isBomRowRead(sql)) {
              return [updated ? { ...BOM_ROW, level: 2, qty: '3.00', unit: null } : { ...BOM_ROW }];
            }
            if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
            if (sql.startsWith('UPDATE bom')) {
              updated = true;
              return { affectedRows: 1 };
            }
            return [];
          },
        }),
      // locateProductCode 走 dataSource.query（事务外）
      query: async (sql: string) => (isLocate(sql) ? [{ product_code: 'JC-PLC-2001' }] : []),
    };
    const service = new BomsService(dataSource as never, { write: auditWrite } as never);
    const result = await service.update('31', { level: 2, unit: null }, CONTEXT);
    expect(result).toMatchObject({ level: 2, qty: '3.00', unit: null });
    expect(auditWrite).toHaveBeenCalledTimes(1);
  });

  it('空 body（无任何可改字段）→ 10001', async () => {
    const { service } = makeHarness({ query: async () => [] });
    await expect(service.update('31', {}, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('BOM 不存在 → 30001（事务外定位即拒绝，不进入事务）', async () => {
    const { service, queries } = makeHarness({ query: async () => [] });
    await expect(service.update('31', { qty: '3.00' }, CONTEXT)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    // 定位失败即返回，未取产品行锁、未读 BOM 行
    expect(queries.some((sql) => isProductLock(sql))).toBe(false);
  });
});

describe('BomsService —— 产品行锁协议（S10 复审 P2 修复 · 第二轮）', () => {
  it('create：产品行锁是**事务内第一条语句**，且早于引用判定与 INSERT', async () => {
    const { service, queries } = makeHarness({
      query: async (sql) => {
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (sql.includes('FROM material')) return [{ code: 'MAT-001' }];
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.includes('FROM bom WHERE')) return [];
        if (sql.startsWith('INSERT INTO bom')) return { insertId: '31' };
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        return [];
      },
    });
    await service.create('JC-PLC-2001', DTO, CONTEXT);

    // 第一条语句就是产品行锁（锁定读不建立快照 → 后续引用判定读到已提交数据）
    expect(isProductLock(queries[0] ?? '')).toBe(true);
    const lockIndex = 0;
    const guardIndex = queries.findIndex((sql) => sql.includes('FROM sale_order'));
    const insertIndex = queries.findIndex((sql) => sql.startsWith('INSERT INTO bom'));
    expect(guardIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(guardIndex);
  });

  it('update：product_code 在**事务外**定位，产品行锁紧跟其后（事务内第一条）', async () => {
    const { service, queries } = makeHarness({
      query: async (sql) => {
        if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.startsWith('UPDATE bom')) return { affectedRows: 1 };
        return [];
      },
    });
    await service.update('31', { qty: '3.00' }, CONTEXT);

    const locateIndex = queries.findIndex((sql) => isLocate(sql));
    const lockIndex = queries.findIndex((sql) => isProductLock(sql));
    // 定位在事务外、产品行锁紧随其后 —— 保证取锁是事务内第一条语句
    expect(locateIndex).toBe(0);
    expect(lockIndex).toBe(locateIndex + 1);
  });

  it('update：顺序为「产品行锁 → bom 行锁 → 引用判定 → 写入」', async () => {
    const { service, queries } = makeHarness({
      query: async (sql) => {
        if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.startsWith('UPDATE bom')) return { affectedRows: 1 };
        return [];
      },
    });
    await service.update('31', { qty: '3.00' }, CONTEXT);

    const lockIndex = queries.findIndex((sql) => isProductLock(sql));
    const bomRowIndex = queries.findIndex((sql) => isBomRowRead(sql) && sql.includes('FOR UPDATE'));
    const guardIndex = queries.findIndex((sql) => sql.includes('FROM sale_order'));
    const updateIndex = queries.findIndex((sql) => sql.startsWith('UPDATE bom'));

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(bomRowIndex).toBeGreaterThan(lockIndex);
    // 引用判定必须在取锁之后 —— 否则仍可读到「无已确认业务」的过期快照
    expect(guardIndex).toBeGreaterThan(bomRowIndex);
    expect(updateIndex).toBeGreaterThan(guardIndex);
  });

  it('回归护栏：不得再使用已废弃的会话级命名锁（GET_LOCK / RELEASE_LOCK）', async () => {
    const { service, queries } = makeHarness({
      query: async (sql) => {
        if (isLocate(sql)) return [{ product_code: 'JC-PLC-2001' }];
        if (isProductLock(sql)) return [{ code: 'JC-PLC-2001' }];
        if (isBomRowRead(sql)) return [{ ...BOM_ROW }];
        if (sql.includes('FROM sale_order') || sql.includes('FROM work_order')) return [];
        if (sql.startsWith('UPDATE bom')) return { affectedRows: 1 };
        return [];
      },
    });
    await service.update('31', { qty: '3.00' }, CONTEXT);

    const joined = queries.join('\n');
    expect(joined).not.toContain('GET_LOCK');
    expect(joined).not.toContain('RELEASE_LOCK');
  });
});
