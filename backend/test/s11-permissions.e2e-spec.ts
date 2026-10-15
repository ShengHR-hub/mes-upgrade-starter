import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { IDENTITY_RESOLVER } from '../src/common/auth/identity-resolver.js';
import { configureApp } from '../src/bootstrap.js';
import type { Role } from '../src/common/auth/identity.types.js';

/**
 * S11 权限与参数校验 e2e（身份替身 + mock 数据源，**不连数据库**）。
 *
 * 覆盖任务书 §九：
 * - B11 SPC / B12 MRP-lite 的三角色权限与越权拒绝（契约 §5.2 第 21、22 行）；
 * - 参数类型、长度、未知字段与重复输入校验（契约 §2.1 / §2.2）；
 * - B12 缺 BOM → 30005、订单不存在 → 30001；
 * - B14 开放 API 未启用：任何角色访问 integrations/* → 404 / 30001（Q8 未批准）。
 *
 * ⚠️ 身份替身与 mock 数据源只在本测试注入；正常启动路径仍是
 * JwtIdentityResolver / NoAuthIdentityResolver（见 route-registration.e2e-spec.ts）。
 */

type App = any;

const ORDER_JC_PLC_2001 = { id: '101', code: 'SO-20261009-001', product_code: 'JC-PLC-2001', qty: 100 };
const ORDER_NO_BOM = { id: '102', code: 'SO-20261009-002', product_code: 'JC-PLC-2002', qty: 50 };

const mockDataSource = {
  options: { type: 'mysql' },
  entityMetadatas: [] as unknown[],
  isInitialized: true,
  query: async (sql: string, params?: unknown[]) => {
    // ⚠️ 顺序敏感：trends 与 good-rates 的 SQL 都含 COALESCE(SUM(r.good_qty),0)，
    // 必须先用各自独有特征（DATE_FORMAT / COUNT(*) AS report_count）区分。
    if (sql.includes("DATE_FORMAT(r.reported_at, '%Y-%m-%d')")) {
      return [{ report_date: '2026-10-09', good_qty: '76', bad_qty: '4' }];
    }
    if (sql.includes('COUNT(*) AS report_count')) {
      return [{ good_qty: '76', bad_qty: '4', report_count: '3' }];
    }
    if (sql.includes('SUM(d.qty)')) {
      return [
        { defect_type: '虚焊', qty: '4' },
        { defect_type: '错件', qty: '2' },
      ];
    }
    if (sql.includes('COUNT(*)')) return [{ total: '0' }];
    // B12 MRP-lite：按请求的订单 ID 返回（102 映射到无 BOM 产品）
    if (sql.startsWith('SELECT id, code, product_code, qty FROM sale_order WHERE id IN')) {
      const ids = (params ?? []).map(String);
      const rows: unknown[] = [];
      if (ids.includes('101')) rows.push(ORDER_JC_PLC_2001);
      if (ids.includes('102')) rows.push(ORDER_NO_BOM);
      return rows;
    }
    if (sql.startsWith('SELECT product_code, material_code, qty FROM bom WHERE product_code')) {
      // 仅 JC-PLC-2001 有 BOM；JC-PLC-2002 缺 BOM → 30005 路径
      return params?.[0] === 'JC-PLC-2001'
        ? [{ product_code: 'JC-PLC-2001', material_code: 'MAT-001', qty: '2.00' }]
        : [];
    }
    return [];
  },
  transaction: async (work: (m: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params?: unknown[]) => mockDataSource.query(sql, params),
    }),
  getRepository: () => ({}),
  destroy: async () => undefined,
};

async function createAppAs(role: Role): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDataSourceToken())
    .useValue(mockDataSource)
    .overrideProvider(IDENTITY_RESOLVER)
    .useValue({
      resolve: async () => ({ id: '1', role, username: role, name: role }),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

const ROLES: Role[] = ['admin', 'manager', 'operator'];

describe('S11 B11 SPC / B12 MRP-lite 权限矩阵（身份替身 + mock 数据源）', () => {
  for (const role of ROLES) {
    describe(`role=${role}`, () => {
      let app: INestApplication<App>;
      let http: ReturnType<typeof request>;

      beforeAll(async () => {
        app = await createAppAs(role);
        http = request(app.getHttpServer());
      });

      afterAll(async () => {
        await app?.close();
      });

      it('B11 SPC 三个接口：admin/manager 200；operator → 403/20004', async () => {
        const paths = [
          '/api/v1/quality-analyses/paretos?startDate=2026-10-09&endDate=2026-10-09',
          '/api/v1/quality-analyses/trends?startDate=2026-10-09&endDate=2026-10-09',
          '/api/v1/quality-analyses/good-rates?startDate=2026-10-09&endDate=2026-10-09',
        ];
        for (const path of paths) {
          const res = await http.get(path);
          if (role === 'operator') {
            expect(res.status, path).toBe(403);
            expect(res.body.code, path).toBe(20004);
          } else {
            expect(res.status, path).toBe(200);
            expect(res.body.code, path).toBe(0);
          }
        }
      });

      it('B11 响应口径：Pareto 降序累计、trends=reportBadRate、good-rates isTrueFpy:false', async () => {
        if (role === 'operator') return; // operator 已由上一用例拒绝
        const pareto = await http.get(
          '/api/v1/quality-analyses/paretos?startDate=2026-10-09&endDate=2026-10-09',
        );
        expect(pareto.body.data.items.map((item: { defectType: string }) => item.defectType)).toEqual([
          '虚焊',
          '错件',
        ]);
        expect(pareto.body.data.items.map((item: { share: number }) => item.share)).toEqual([66.67, 33.33]);
        expect(
          pareto.body.data.items.map((item: { cumulativeShare: number }) => item.cumulativeShare),
        ).toEqual([66.67, 100]);
        expect(pareto.body.data.dataSource).toBe('demo');
        expect(pareto.body.data.dataLabel).toBe('演示数据');

        const trend = await http.get(
          '/api/v1/quality-analyses/trends?startDate=2026-10-09&endDate=2026-10-09',
        );
        expect(trend.body.data.metric).toBe('reportBadRate');
        expect(trend.body.data.points).toEqual([
          { date: '2026-10-09', goodQty: 76, badQty: 4, badRate: 5 },
        ]);

        const goodRate = await http.get(
          '/api/v1/quality-analyses/good-rates?startDate=2026-10-09&endDate=2026-10-09',
        );
        expect(goodRate.body.data.metric).toBe('reportGoodRate');
        expect(goodRate.body.data.value).toBe(95);
        expect(goodRate.body.data.isTrueFpy).toBe(false);
      });

      it('B12 MRP-lite：admin/manager 200；operator → 403/20004', async () => {
        const res = await http.post('/api/v1/material-requirement-calculations').send({ orderIds: ['101'] });
        if (role === 'operator') {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe(20004);
        } else {
          expect(res.status).toBe(200);
          expect(res.body.code).toBe(0);
          expect(res.body.data.calculationScope).toBe('flat-bom-gross-requirements');
          expect(res.body.data.items).toEqual([
            {
              materialCode: 'MAT-001',
              grossRequiredQty: '200.00',
              inboundQty: 0,
              availableQty: null,
              shortageQty: null,
              purchaseSuggestionQty: null,
            },
          ]);
          expect(res.body.data.limitations.length).toBeGreaterThan(0);
        }
      });

      it('B12 业务校验：缺 BOM → 30005/422；订单不存在 → 30001/404', async () => {
        if (role === 'operator') return;
        const missingBom = await http
          .post('/api/v1/material-requirement-calculations')
          .send({ orderIds: ['102'] });
        expect(missingBom.status).toBe(422);
        expect(missingBom.body.code).toBe(30005);

        const notFound = await http
          .post('/api/v1/material-requirement-calculations')
          .send({ orderIds: ['999'] });
        expect(notFound.status).toBe(404);
        expect(notFound.body.code).toBe(30001);
      });

      it('B14 开放 API 未启用：integrations/* → 404 / 30001（不写库、不鉴权放行）', async () => {
        const resErp = await http.post('/api/v1/integrations/erp-orders').send({
          source: 'erp',
          externalOrderCode: 'EXT-001',
          productCode: 'JC-PLC-2001',
          qty: 1,
          dueDate: '2026-10-09',
        });
        expect(resErp.status).toBe(404);
        expect(resErp.body.code).toBe(30001);

        const resDevice = await http.post('/api/v1/integrations/device-events').send({
          source: 'plc',
          eventId: 'EVT-001',
          deviceCode: 'EQP-SMT-006',
          status: '运行中',
          occurredAt: '2026-10-14T21:00:00+08:00',
        });
        expect(resDevice.status).toBe(404);
        expect(resDevice.body.code).toBe(30001);
      });
    });
  }
});

describe('S11 参数校验（admin 身份 + mock 数据源）', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createAppAs('admin');
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('B11 缺必填日期 / 非法真实日期 / 逆序区间 / 未知字段 / 超长 stepName → 10001', async () => {
    const longStepName = 'x'.repeat(33);
    const paths = [
      '/api/v1/quality-analyses/paretos',
      '/api/v1/quality-analyses/paretos?startDate=2026-10-09',
      '/api/v1/quality-analyses/paretos?startDate=2026-13-01&endDate=2026-10-09',
      '/api/v1/quality-analyses/paretos?startDate=2026-02-31&endDate=2026-10-09',
      '/api/v1/quality-analyses/paretos?startDate=2026-10-10&endDate=2026-10-09',
      '/api/v1/quality-analyses/paretos?startDate=2026-10-09&endDate=2026-10-09&unknownField=1',
      `/api/v1/quality-analyses/trends?startDate=2026-10-09&endDate=2026-10-09&stepName=${longStepName}`,
      '/api/v1/quality-analyses/good-rates?startDate=2026-10-09&endDate=2026-10-09&prodLine=' +
        'y'.repeat(33),
    ];
    for (const path of paths) {
      const res = await http.get(path);
      expect(res.status, path).toBe(400);
      expect(res.body.code, path).toBe(10001);
    }
  });

  it('B12 orderIds 类型 / 长度 / 空数组 / 重复项 / 未知字段 → 10001', async () => {
    const notArray = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: '101' });
    expect(notArray.status).toBe(400);
    expect(notArray.body.code).toBe(10001);

    const empty = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: [] });
    expect(empty.body.code).toBe(10001);

    const overLimit = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) });
    expect(overLimit.body.code).toBe(10001);

    const duplicated = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: ['101', '101'] });
    expect(duplicated.status).toBe(400);
    expect(duplicated.body.code).toBe(10001);

    const unknownField = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: ['101'], unknownField: 1 });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.code).toBe(10001);

    const nonNumeric = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: ['abc'] });
    expect(nonNumeric.body.code).toBe(10001);

    const overBigint = await http
      .post('/api/v1/material-requirement-calculations')
      .send({ orderIds: ['9223372036854775808'] });
    expect(overBigint.body.code).toBe(10001);
  });
});
