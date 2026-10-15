import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import {
  DataQueriesQueryExecutor,
  isAllowedQueryCombo,
  normalizeLineCode,
} from './data-queries.query.js';

/**
 * S9 审查 P2 修复回归：
 * - P2-1 产线别名解析（SMT-2 → SMT-2线）与未知产线拒绝扩大为全厂；
 * - P2-4 组合矩阵与执行器实际能力严格一致。
 */
describe('DataQueriesQueryExecutor · 产线别名解析（P2-1）', () => {
  it('规范编号映射到数据库实际名称集合（SMT-2 → SMT-2线）', async () => {
    const queryMock = vi.fn(async (sql: string) => {
      if (sql.includes('UNION')) {
        return [{ prod_line: 'SMT-1线' }, { prod_line: 'SMT-2线' }, { prod_line: 'CAL-1线' }];
      }
      return [];
    });
    const executor = new DataQueriesQueryExecutor({ query: queryMock } as any);
    const metricsService = {
      getProductionMetrics: vi.fn(async () => ({
        metrics: { calculationStatus: 'available', planTotalQty: 100, outputQty: 80, goodQty: 76, badQty: 4, goodRate: 95 },
        lines: [],
      })),
    };

    await executor.execute(
      'goodRate',
      'prodLine',
      '2026-10-13',
      '2026-10-13',
      'SMT-2',
      '2026-10-13T09:00:00+08:00',
      metricsService as any,
    );

    expect(metricsService.getProductionMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ prodLines: ['SMT-2线'] }),
      expect.any(String),
    );
  });

  it('数据库无匹配实际名称 → unknownProdLineReason，不执行查询', async () => {
    const queryMock = vi.fn(async (sql: string) =>
      sql.includes('UNION') ? [{ prod_line: 'SMT-1线' }] : [],
    );
    const executor = new DataQueriesQueryExecutor({ query: queryMock } as any);
    const metricsService = {
      getProductionMetrics: vi.fn(),
    };

    const result = await executor.execute(
      'outputQty',
      'date',
      '2026-10-13',
      '2026-10-13',
      'SMT-2',
      '2026-10-13T09:00:00+08:00',
      metricsService as any,
    );

    expect(result.rows).toEqual([]);
    expect(result.unknownProdLineReason).toContain('SMT-2');
    expect(metricsService.getProductionMetrics).not.toHaveBeenCalled();
  });

  it('大小写与「线」后缀均可匹配（smt-2 ↔ SMT-2线）', async () => {
    const queryMock = vi.fn(async (sql: string) =>
      sql.includes('UNION') ? [{ prod_line: 'SMT-2线' }] : [],
    );
    const executor = new DataQueriesQueryExecutor({ query: queryMock } as any);
    const metricsService = {
      getProductionMetrics: vi.fn(async () => ({
        metrics: { calculationStatus: 'available', planTotalQty: 0, outputQty: 0, goodQty: 0, badQty: 0, goodRate: null },
        lines: [],
      })),
    };

    const result = await executor.execute(
      'goodQty',
      'prodLine',
      '2026-10-13',
      '2026-10-13',
      'smt-2',
      '2026-10-13T09:00:00+08:00',
      metricsService as any,
    );

    expect(result.unknownProdLineReason).toBeNull();
    expect(metricsService.getProductionMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ prodLines: ['SMT-2线'] }),
      expect.any(String),
    );
  });

  it('defect 查询按实际名称 IN 过滤', async () => {
    const queryMock = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('UNION')) return [{ prod_line: 'CAL-1线' }];
      expect(sql).toContain('t.prod_line IN (?)');
      return [{ group_key: '虚焊', qty: 6 }];
    });
    const executor = new DataQueriesQueryExecutor({ query: queryMock } as any);

    const result = await executor.execute(
      'defectQty',
      'defectType',
      '2026-10-13',
      '2026-10-13',
      'CAL-1',
      '2026-10-13T09:00:00+08:00',
      {} as any,
    );

    expect(queryMock.mock.calls[1]?.[1]).toEqual([
      '2026-10-13 00:00:00',
      '2026-10-14 00:00:00',
      'CAL-1线',
    ]);
    expect(result.rows[0]).toMatchObject({ defectType: '虚焊', defectQty: 6 });
  });

  it('device 查询按实际名称 IN 过滤', async () => {
    const queryMock = vi.fn(async (sql: string, _params: unknown[] = []) => {
      if (sql.includes('UNION')) return [{ prod_line: 'SMT-2线' }];
      expect(sql).toContain('prod_line IN (?)');
      return [
        { code: 'EQP-SMT-006', name: '回流焊炉', prod_line: 'SMT-2线', status: '维修中' },
      ];
    });
    const executor = new DataQueriesQueryExecutor({ query: queryMock } as any);

    const result = await executor.execute(
      'deviceStatus',
      'device',
      '2026-10-13',
      '2026-10-13',
      'SMT-2',
      '2026-10-13T09:00:00+08:00',
      {} as any,
    );

    expect(queryMock.mock.calls[1]?.[1]).toEqual(['SMT-2线']);
    expect(result.rows[0]).toMatchObject({ device: 'EQP-SMT-006', deviceStatus: '维修中' });
  });

  it('时间窗口超过 7 天 → 10001（成本护栏）', async () => {
    const executor = new DataQueriesQueryExecutor({ query: vi.fn(async () => []) } as any);
    await expect(
      executor.execute(
        'outputQty',
        'date',
        '2026-10-01',
        '2026-10-13',
        null,
        '2026-10-13T09:00:00+08:00',
        {} as any,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
  });
});

describe('组合矩阵与执行器能力一致性（P2-4）', () => {
  it('deviceStatus 仅允许 device + list', () => {
    expect(isAllowedQueryCombo('deviceStatus', 'device', 'list')).toBe(true);
    expect(isAllowedQueryCombo('deviceStatus', 'device', 'trend')).toBe(false);
    expect(isAllowedQueryCombo('deviceStatus', 'prodLine', 'list')).toBe(false);
  });

  it('报工/工单指标仅允许 prodLine / date 分组（device 分组不再放行）', () => {
    expect(isAllowedQueryCombo('outputQty', 'device', 'list')).toBe(false);
    expect(isAllowedQueryCombo('outputQty', 'device', 'minimum')).toBe(false);
    expect(isAllowedQueryCombo('goodRate', 'device', 'maximum')).toBe(false);
    expect(isAllowedQueryCombo('outputQty', 'prodLine', 'list')).toBe(true);
    expect(isAllowedQueryCombo('outputQty', 'date', 'trend')).toBe(true);
    expect(isAllowedQueryCombo('goodRate', 'prodLine', 'minimum')).toBe(true);
    expect(isAllowedQueryCombo('outputQty', 'date', 'list')).toBe(true);
    expect(isAllowedQueryCombo('outputQty', 'prodLine', 'trend')).toBe(false);
  });

  it('defectQty 允许 defectType / prodLine / date，拒绝 device', () => {
    expect(isAllowedQueryCombo('defectQty', 'defectType', 'list')).toBe(true);
    expect(isAllowedQueryCombo('defectQty', 'prodLine', 'list')).toBe(true);
    expect(isAllowedQueryCombo('defectQty', 'date', 'trend')).toBe(true);
    expect(isAllowedQueryCombo('defectQty', 'device', 'list')).toBe(false);
    expect(isAllowedQueryCombo('defectQty', 'defectType', 'minimum')).toBe(false);
  });

  it('白名单外取值一律拒绝', () => {
    expect(isAllowedQueryCombo('oee' as any, 'prodLine', 'list')).toBe(false);
    expect(isAllowedQueryCombo('goodRate' as any, 'workshop' as any, 'list')).toBe(false);
    expect(isAllowedQueryCombo('goodRate' as any, 'prodLine', 'average')).toBe(false);
  });
});

describe('normalizeLineCode', () => {
  it('去空白、去尾部「线」、大写', () => {
    expect(normalizeLineCode('SMT-2线')).toBe('SMT-2');
    expect(normalizeLineCode(' smt-2 ')).toBe('SMT-2');
    expect(normalizeLineCode('CAL-1线')).toBe('CAL-1');
    expect(normalizeLineCode('未分配')).toBe('未分配');
  });
});
