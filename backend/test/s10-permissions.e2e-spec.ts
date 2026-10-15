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
 * 三角色接口权限矩阵 e2e（身份替身 + mock 数据源，**不连数据库**）。
 *
 * 覆盖任务书 §九.5：契约 §5.2 权限矩阵在真实路由 + 守卫链上的落地；
 * 以及 §九.7/§九.8 的守护语义（fail-closed 下的 401）。
 *
 * ⚠️ 身份替身只在本测试注入；正常启动路径仍是 JwtIdentityResolver /
 * NoAuthIdentityResolver（见 route-registration.e2e-spec.ts）。
 */

type App = any;

const mockDataSource = {
  options: { type: 'mysql' },
  entityMetadatas: [] as unknown[],
  isInitialized: true,
  query: async (sql: string) => {
    if (sql.includes('COUNT(*)')) return [{ total: '0' }];
    if (sql.startsWith('SELECT id, username, name, dept, post, role, phone, enabled')) {
      return [
        {
          id: '1',
          username: 'admin',
          name: '测试账号',
          dept: null,
          post: null,
          role: 'admin',
          phone: null,
          enabled: 1,
        },
      ];
    }
    if (sql.startsWith('SELECT code, status FROM device WHERE code = ?')) {
      return [{ code: 'EQP-SMT-006', status: '维修中' }];
    }
    if (sql.startsWith('SELECT code FROM device WHERE code = ?')) {
      return [{ code: 'EQP-SMT-006' }];
    }
    if (sql.startsWith('SELECT code FROM product WHERE code = ?')) {
      return [{ code: 'JC-PLC-2001' }];
    }
    return [];
  },
  transaction: async (work: (m: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ total: '0' }];
        if (sql.startsWith('SELECT code, status FROM device WHERE code = ?')) {
          return [{ code: 'EQP-SMT-006', status: '维修中' }];
        }
        return [];
      },
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

describe('三角色权限矩阵（身份替身 + mock 数据源）', () => {
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

      it('主数据与追溯读接口：三角色均可（200）', async () => {
        const readPaths = [
          '/api/v1/products',
          '/api/v1/materials',
          '/api/v1/products/JC-PLC-2001/boms',
          '/api/v1/material-batches',
          '/api/v1/material-batches/1/sn-traces',
          '/api/v1/sn-traces',
          '/api/v1/devices',
          '/api/v1/devices/EQP-SMT-006',
          '/api/v1/devices/EQP-SMT-006/state-logs',
          '/api/v1/work-orders',
          '/api/v1/reports',
        ];
        for (const path of readPaths) {
          const res = await http.get(path);
          // material-batches/1/sn-traces 在 mock 下批次不存在 → 30001；
          // 到达服务层即证明守卫放行，其余列表应为 code 0
          expect([0, 30001], path).toContain(res.body.code);
        }
      });

      it('GET /users/me：三角色均可（200）', async () => {
        const res = await http.get('/api/v1/users/me');
        expect(res.status).toBe(200);
        expect(res.body.code).toBe(0);
      });

      it('日志与用户管理：仅 admin（manager/operator → 403）', async () => {
        for (const path of [
          '/api/v1/users',
          '/api/v1/audit-logs',
          '/api/v1/ai-query-logs',
          '/api/v1/role-permissions',
        ]) {
          const res = await http.get(path);
          if (role === 'admin') {
            expect(res.status, path).toBe(200);
          } else {
            expect(res.status, path).toBe(403);
            expect(res.body.code, path).toBe(20004);
          }
        }
      });

      it('OEE 查询：仅 admin/manager（operator → 403）', async () => {
        const res = await http.get('/api/v1/devices/EQP-SMT-006/oee-analyses');
        if (role === 'operator') {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe(20004);
        } else {
          expect(res.status).toBe(200);
          expect(res.body.data.calculationStatus).toBe('insufficient_data');
          expect(res.body.data.missingInputs).toEqual(['计划生产时间', '设备产出归属', '理想节拍']);
        }
      });

      it('物料安全库存 PATCH：admin/manager 可达服务层，operator → 403', async () => {
        const res = await http.patch('/api/v1/materials/MAT-001').send({ safetyStock: 10 });
        if (role === 'operator') {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe(20004);
        } else {
          // mock 下物料不存在 → 30001；到达服务层即说明守卫放行
          expect(res.body.code).toBe(30001);
        }
      });

      it('设备状态迁移：三角色均在服务层被 30006 拒绝（Q3 未批准，写入关闭）', async () => {
        const res = await http
          .post('/api/v1/devices/EQP-SMT-006/state-transitions')
          .send({ expectedStatus: '维修中', targetStatus: '待机' });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(30006);
      });

      it('expectedStatus 冲突 → 30003（并发不覆盖新状态）', async () => {
        const res = await http
          .post('/api/v1/devices/EQP-SMT-006/state-transitions')
          .send({ expectedStatus: '运行中', targetStatus: '待机' });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(30003);
      });
    });
  }
});
