import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { IDENTITY_RESOLVER } from '../src/common/auth/identity-resolver.js';

// 仅测试路径中的身份替身与数据库替身；无真实JWT、无MySQL连接。
const dataSource = {
  options: { type: 'mysql' }, entityMetadatas: [], isInitialized: true,
  query: async (sql: string) => sql.includes('COUNT') ? [{ cnt: 0, total: 0 }] : [],
  getRepository: () => ({}), destroy: async () => {},
};
let queryCount = 0; const originalQuery = dataSource.query; dataSource.query = async (sql: string) => { queryCount++; return originalQuery(sql); }; let app: INestApplication;
beforeAll(async () => {
  const fixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDataSourceToken()).useValue(dataSource)
    .overrideProvider(IDENTITY_RESOLVER).useValue({ resolve: (req: any) => {
      const role = req.headers['x-review-role'];
      return ['admin', 'manager', 'operator'].includes(role) ? { id: '1', role } : null;
    } }).compile();
  app = fixture.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

describe('独立HTTP探针：S7权限与输入契约（测试身份/数据库替身）', () => {
  const routes = [
    '/api/v1/dashboards/production-metrics?startDate=2026-10-09&endDate=2026-10-09',
    '/api/v1/dashboards/quality-metrics?startDate=2026-10-09&endDate=2026-10-09',
    '/api/v1/dashboards/device-metrics',
    '/api/v1/dashboards/delivery-metrics?startDate=2026-10-09&endDate=2026-10-09',
    '/api/v1/alerts',
  ];
  for (const role of ['admin', 'manager']) {
    it(`${role}可读取5条接口且包体符合契约`, async () => {
      for (const path of routes) {
        const response = await request(app.getHttpServer()).get(path).set('x-review-role', role).expect(200);
        expect(response.body.code).toBe(0);
        expect(response.headers['x-request-id']).toBeTruthy();
      }
    });
  }
  it('operator读取5条接口均403/20004', async () => {
    for (const path of routes) {
      const response = await request(app.getHttpServer()).get(path).set('x-review-role', 'operator').expect(403);
      expect(response.body.code).toBe(20004);
    }
  });
  it('错误日期、逆序日期、缺必填日期、未知查询字段均400/10001', async () => {
    const queries = ['startDate=2026-02-31&endDate=2026-03-01', 'startDate=2026-10-10&endDate=2026-10-09', 'endDate=2026-10-09', 'startDate=2026-10-09&endDate=2026-10-09&unexpected=1'];
    for (const query of queries) {
      const response = await request(app.getHttpServer()).get(`/api/v1/dashboards/production-metrics?${query}`).set('x-review-role', 'admin').expect(400);
      expect(response.body.code).toBe(10001);
    }
  });
  it('预警无效枚举、未知参数与BIGINT越界均400/10001', async () => {
    for (const path of ['/api/v1/alerts?status=invalid', '/api/v1/alerts?level=invalid', '/api/v1/alerts?unexpected=1', '/api/v1/alerts/9223372036854775808']) {
      const response = await request(app.getHttpServer()).get(path).set('x-review-role', 'manager').expect(400);
      expect(response.body.code).toBe(10001);
    }
  });
  it('不存在的预警详情404/30001', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/alerts/1').set('x-review-role', 'admin').expect(404);
    expect(response.body.code).toBe(30001);
  });
});

describe('本轮独立HTTP探针 Q6', () => {
  it('admin流转返回422/30006且不查询数据库', async () => {
    const before = queryCount;
    const response = await request(app.getHttpServer()).post('/api/v1/alerts/1/state-transitions')
      .set('x-review-role', 'admin').send({ expectedStatus: '未处理', targetStatus: '已确认' }).expect(422);
    expect(response.body.code).toBe(30006);
    expect(queryCount).toBe(before);
  });
});
