import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';

import { MaterialRequirementsService } from './material-requirements.service.js';

/**
 * B12 MRP-lite 服务单测（替身数据源，不连数据库）。
 *
 * 覆盖任务书 §九后端测试要求：
 * - 毛需求计算（订单数量 × BOM 用量，聚合到物料）；
 * - 订单去重、上限 100、缺 BOM（30005）；
 * - availableQty / shortageQty / purchaseSuggestionQty 保持 null；
 * - limitations 说明不存在净缺口/采购量能力。
 */

interface Executed {
  sql: string;
  params: unknown[];
}

const ORDER_ROW = (id: string, productCode: string, qty: number) => ({
  id,
  code: `SO-20261009-${id}`,
  product_code: productCode,
  qty,
});

const BOM_ROW = (productCode: string, materialCode: string, qty: string) => ({
  product_code: productCode,
  material_code: materialCode,
  qty,
});

function makeHarness(options: {
  orders?: unknown[];
  boms?: unknown[];
  inbound?: unknown[];
  /** 有 BOM 的产品集合（缺省全部产品都有） */
  bomProducts?: readonly string[];
}): { service: MaterialRequirementsService; executed: Executed[] } {
  const executed: Executed[] = [];
  const run = async (sql: string, params?: unknown[]): Promise<unknown> => {
    executed.push({ sql, params: params ?? [] });
    if (sql.includes('FROM sale_order')) return options.orders ?? [];
    if (sql.includes('FROM bom')) {
      const rows = options.boms ?? [];
      if (options.bomProducts) {
        const productCode = String(params?.[0] ?? '');
        return rows.filter((row) => String((row as { product_code: string }).product_code) === productCode);
      }
      return rows;
    }
    if (sql.includes('FROM material_batch')) return options.inbound ?? [];
    return [];
  };
  const dataSource = {
    transaction: (...args: unknown[]) => {
      const maybeRun = args[args.length - 1] as (executor: unknown) => Promise<unknown>;
      return maybeRun({ query: run });
    },
    query: run,
  };
  return { service: new MaterialRequirementsService(dataSource as never), executed };
}

const SNAPSHOT = '2026-10-14T21:00:00+08:00';

describe('MaterialRequirementsService.calculate —— 参数校验', () => {
  it('orderIds 为空数组 → 10001', async () => {
    const { service } = makeHarness({});
    await expect(service.calculate({ orderIds: [] }, SNAPSHOT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('超过 100 个 → 10001', async () => {
    const { service } = makeHarness({});
    const orderIds = Array.from({ length: 101 }, (_, i) => String(i + 1));
    await expect(service.calculate({ orderIds }, SNAPSHOT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('重复 orderIds → 10001（去重）', async () => {
    const { service } = makeHarness({});
    await expect(
      service.calculate({ orderIds: ['101', '101'] }, SNAPSHOT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('非 BIGINT 十进制 ID / 超过 BIGINT 上限 → 10001', async () => {
    const { service } = makeHarness({});
    await expect(service.calculate({ orderIds: ['abc'] }, SNAPSHOT)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
    await expect(
      service.calculate({ orderIds: ['9223372036854775808'] }, SNAPSHOT),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });

  it('负数 / 小数 / 空串 ID → 10001', async () => {
    const { service } = makeHarness({});
    for (const bad of ['-1', '1.5', '']) {
      await expect(service.calculate({ orderIds: [bad] }, SNAPSHOT)).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    }
  });
});

describe('MaterialRequirementsService.calculate —— 业务校验', () => {
  it('订单不存在 → 30001（不使用部分结果）', async () => {
    const { service } = makeHarness({ orders: [ORDER_ROW('101', 'JC-PLC-2001', 100)] });
    await expect(
      service.calculate({ orderIds: ['101', '102'] }, SNAPSHOT),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
  });

  it('缺 BOM → 30005（不当当作「无需物料」）', async () => {
    const { service } = makeHarness({
      orders: [ORDER_ROW('101', 'JC-PLC-2001', 100)],
      boms: [],
    });
    await expect(service.calculate({ orderIds: ['101'] }, SNAPSHOT)).rejects.toMatchObject({
      code: ErrorCode.MISSING_PREREQUISITE,
    });
  });

  it('部分订单有 BOM、部分缺 BOM → 整体 30005（不静默漏算物料）', async () => {
    const { service } = makeHarness({
      orders: [
        ORDER_ROW('101', 'JC-PLC-2001', 100),
        ORDER_ROW('102', 'JC-PLC-2002', 50),
      ],
      boms: [BOM_ROW('JC-PLC-2001', 'MAT-001', '2.00')],
      bomProducts: ['JC-PLC-2001'], // JC-PLC-2002 无 BOM
    });
    await expect(
      service.calculate({ orderIds: ['101', '102'] }, SNAPSHOT),
    ).rejects.toMatchObject({ code: ErrorCode.MISSING_PREREQUISITE });
  });
});

describe('MaterialRequirementsService.calculate —— 毛需求', () => {
  it('100 × 2.00 = "200.00"，十进制字符串且聚合到物料维度', async () => {
    const { service } = makeHarness({
      orders: [ORDER_ROW('101', 'JC-PLC-2001', 100)],
      boms: [
        BOM_ROW('JC-PLC-2001', 'MAT-001', '2.00'),
        BOM_ROW('JC-PLC-2001', 'MAT-002', '0.50'),
      ],
    });

    const result = await service.calculate({ orderIds: ['101'] }, SNAPSHOT);

    expect(result.calculationScope).toBe('flat-bom-gross-requirements');
    expect(result.items).toEqual([
      {
        materialCode: 'MAT-001',
        grossRequiredQty: '200.00',
        inboundQty: 0,
        availableQty: null,
        shortageQty: null,
        purchaseSuggestionQty: null,
      },
      {
        materialCode: 'MAT-002',
        grossRequiredQty: '50.00',
        inboundQty: 0,
        availableQty: null,
        shortageQty: null,
        purchaseSuggestionQty: null,
      },
    ]);
    expect(result.orderIds).toEqual(['101']);
    expect(result.dataSource).toBe('demo');
    expect(result.dataLabel).toBe('演示数据');
  });

  it('多订单同物料毛需求按数量累加（精确 2 位小数）', async () => {
    const { service } = makeHarness({
      orders: [
        ORDER_ROW('101', 'JC-PLC-2001', 100),
        ORDER_ROW('102', 'JC-PLC-2001', 33),
      ],
      boms: [BOM_ROW('JC-PLC-2001', 'MAT-001', '1.10')],
    });

    const result = await service.calculate({ orderIds: ['101', '102'] }, SNAPSHOT);
    // 100×1.10 + 33×1.10 = 110.00 + 36.30 = 146.30
    expect(result.items[0].grossRequiredQty).toBe('146.30');
  });

  it('inboundQty 返回累计入库数量（仅信息，不等于可用库存）', async () => {
    const { service } = makeHarness({
      orders: [ORDER_ROW('101', 'JC-PLC-2001', 100)],
      boms: [BOM_ROW('JC-PLC-2001', 'MAT-001', '2.00')],
      inbound: [{ material_code: 'MAT-001', total_qty: '100' }],
    });

    const result = await service.calculate({ orderIds: ['101'] }, SNAPSHOT);
    expect(result.items[0].inboundQty).toBe(100);
    // 铁律：入库数量不得推导为可用库存
    expect(result.items[0].availableQty).toBeNull();
    expect(result.items[0].shortageQty).toBeNull();
    expect(result.items[0].purchaseSuggestionQty).toBeNull();
  });

  it('limitations 明确说明不能计算净缺口与采购量', async () => {
    const { service } = makeHarness({
      orders: [ORDER_ROW('101', 'JC-PLC-2001', 100)],
      boms: [BOM_ROW('JC-PLC-2001', 'MAT-001', '2.00')],
    });
    const result = await service.calculate({ orderIds: ['101'] }, SNAPSHOT);
    expect(result.limitations.join('\n')).toContain('净缺口');
    expect(result.limitations.join('\n')).toContain('不等于可用库存');
  });

  it('读取在事务内完成（REPEATABLE READ 一致性读）', async () => {
    const { service, executed } = makeHarness({
      orders: [ORDER_ROW('101', 'JC-PLC-2001', 100)],
      boms: [BOM_ROW('JC-PLC-2001', 'MAT-001', '2.00')],
    });
    await service.calculate({ orderIds: ['101'] }, SNAPSHOT);
    // sale_order / bom / material_batch 三次查询都在同一 executor 内
    expect(executed.filter((entry) => entry.sql.includes('FROM sale_order')).length).toBe(1);
    expect(executed.filter((entry) => entry.sql.includes('FROM bom')).length).toBe(1);
    expect(executed.filter((entry) => entry.sql.includes('FROM material_batch')).length).toBe(1);
    // 不产生任何写语句
    for (const entry of executed) {
      expect(entry.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    }
  });
});
