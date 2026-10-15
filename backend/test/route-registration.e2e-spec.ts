import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { AiQueryLog } from '../src/entities/ai-query-log.entity.js';
import { Alert } from '../src/entities/alert.entity.js';
import { AuditLog } from '../src/entities/audit-log.entity.js';
import { Bom } from '../src/entities/bom.entity.js';
import { Device } from '../src/entities/device.entity.js';
import { EquipmentLog } from '../src/entities/equipment-log.entity.js';
import { Material } from '../src/entities/material.entity.js';
import { MaterialBatch } from '../src/entities/material-batch.entity.js';
import { ProcessRoute } from '../src/entities/process-route.entity.js';
import { Product } from '../src/entities/product.entity.js';
import { SaleOrder } from '../src/entities/sale-order.entity.js';
import { SnTrace } from '../src/entities/sn-trace.entity.js';
import { SysUser } from '../src/entities/sys-user.entity.js';
import { WorkOrder } from '../src/entities/work-order.entity.js';
import { WorkTask } from '../src/entities/work-task.entity.js';

/**
 * 路由注册 + fail-closed 鉴权（**不需要数据库**）。
 *
 * 目的：在没有数据库口令的环境里，仍然验证
 * 1. 整个 DI 图（模块 / 守卫 / 服务 / 实体 forFeature）能够完成装配；
 * 2. S5 新增的路由确实注册、未启用路由确实不存在；
 * 3. **正常启动路径下业务接口一律 401**（`IDENTITY_RESOLVER` 默认实现恒返回 null）。
 *
 * 做法：用 mock DataSource 替换 `getDataSourceToken()`，避免真实连库；
 * **不覆盖** `IDENTITY_RESOLVER`，因此这里跑的就是正常启动路径的鉴权行为。
 */
const mockDataSource = {
  options: { type: 'mysql' },
  entityMetadatas: [] as unknown[],
  isInitialized: true,
  query: async () => [{ ok: 1 }],
  getRepository: () => ({}),
  destroy: async () => undefined,
};

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDataSourceToken())
    .useValue(mockDataSource)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe('DI 装配与路由注册', () => {
  it('公开运维接口可用（不要求认证）', async () => {
    const response = await http.get('/api/v1/health').expect(200);
    expect(response.body.code).toBe(0);
  });

  it('S5/S6 业务路由已注册：未认证时返回 401（fail-closed）', async () => {
    const probes: Array<[string, string]> = [
      ['get', '/api/v1/orders'],
      ['get', '/api/v1/orders/1'],
      ['post', '/api/v1/orders'],
      ['patch', '/api/v1/orders/1'],
      ['post', '/api/v1/orders/1/confirmations'],
      ['get', '/api/v1/work-orders'],
      ['get', '/api/v1/work-orders/1'],
      ['patch', '/api/v1/work-orders/1'],
      ['get', '/api/v1/work-orders/1/tasks'],
      ['get', '/api/v1/tasks/1'],
      ['patch', '/api/v1/tasks/1'],
      ['post', '/api/v1/work-orders/1/state-transitions'],
      ['post', '/api/v1/tasks/1/state-transitions'],
      ['get', '/api/v1/products'],
      // S6: B3 生产报工 & B4 质量检验
      ['get', '/api/v1/reports'],
      ['post', '/api/v1/reports'],
      ['get', '/api/v1/quality-inspections'],
      ['get', '/api/v1/quality-inspections/1'],
      ['post', '/api/v1/quality-inspections'],
      ['get', '/api/v1/defects'],
      // S7: B8 经营驾驶舱 & B10 预警中心
      ['get', '/api/v1/dashboards/production-metrics'],
      ['get', '/api/v1/dashboards/quality-metrics'],
      ['get', '/api/v1/dashboards/device-metrics'],
      ['get', '/api/v1/dashboards/delivery-metrics'],
      ['get', '/api/v1/alerts'],
      ['get', '/api/v1/alerts/1'],
      ['post', '/api/v1/alerts/1/state-transitions'],
      // S8: F4 预警根因分析 & F2 AI 生产日报
      ['post', '/api/v1/alerts/1/root-cause-analyses'],
      ['post', '/api/v1/daily-reports'],
      // S9: F3 智能问数
      ['post', '/api/v1/data-queries'],
      // S10/B9: 认证与用户管理（登录为公共接口，单独断言）
      ['get', '/api/v1/users'],
      ['post', '/api/v1/users'],
      ['patch', '/api/v1/users/1'],
      ['get', '/api/v1/users/me'],
      ['post', '/api/v1/users/me/password-changes'],
      ['get', '/api/v1/role-permissions'],
      ['get', '/api/v1/audit-logs'],
      ['get', '/api/v1/ai-query-logs'],
      // S10/B5: 物料 / BOM / 批次
      ['get', '/api/v1/materials'],
      ['patch', '/api/v1/materials/CODE'],
      ['get', '/api/v1/products/JC-PLC-2001/boms'],
      ['post', '/api/v1/products/JC-PLC-2001/boms'],
      ['patch', '/api/v1/boms/1'],
      ['delete', '/api/v1/boms/1'],
      ['get', '/api/v1/material-batches'],
      ['post', '/api/v1/material-batches'],
      ['get', '/api/v1/material-batches/1/sn-traces'],
      // S10/B6: SN 追溯
      ['get', '/api/v1/sn-traces'],
      ['get', '/api/v1/sn-traces/DEMO-SN-001'],
      ['post', '/api/v1/sn-traces'],
      ['patch', '/api/v1/sn-traces/DEMO-SN-001'],
      ['post', '/api/v1/sn-traces/DEMO-SN-001/exports'],
      // S10/B7: 设备
      ['get', '/api/v1/devices'],
      ['get', '/api/v1/devices/EQP-SMT-006'],
      ['post', '/api/v1/devices/EQP-SMT-006/state-transitions'],
      ['get', '/api/v1/devices/EQP-SMT-006/state-logs'],
      ['get', '/api/v1/devices/EQP-SMT-006/oee-analyses'],
      // S11/B11: SPC 质量分析（admin/manager；operator 由 s11-permissions 单独断言）
      ['get', '/api/v1/quality-analyses/paretos'],
      ['get', '/api/v1/quality-analyses/trends'],
      ['get', '/api/v1/quality-analyses/good-rates'],
      // S11/B12: MRP-lite 毛需求计算（admin/manager；operator 由 s11-permissions 单独断言）
      ['post', '/api/v1/material-requirement-calculations'],
    ];

    for (const [method, path] of probes) {
      const response = await (method === 'get' ? http.get(path) : method === 'post' ? http.post(path) : http.patch(path));
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(response.body.code, `${method.toUpperCase()} ${path}`).toBe(20001);
    }
  });

  it('本版未启用的路由不存在（404 / 30001）', async () => {
    const probes: Array<[string, string]> = [
      ['delete', '/api/v1/orders/1'],
      ['delete', '/api/v1/work-orders/1'],
      ['post', '/api/v1/work-orders'],
      ['post', '/api/v1/tasks'],
      // F1 RAG 知识问答尚未实现（S9 范围不含 F1；列入 S10 交接说明）
      ['post', '/api/v1/rag-answers'],
      ['get', '/api/v1/knowledge-sources'],
      // B14 开放 API：本版未启用（Q8 未批准：无集成身份、外部编号、eventId 幂等存储）。
      // 未启用 = 路由不注册 → 404/30001；不接受匿名设备上传或浏览器 JWT 冒充集成身份。
      ['post', '/api/v1/integrations/erp-orders'],
      ['post', '/api/v1/integrations/device-events'],
    ];

    for (const [method, path] of probes) {
      const response = await (method === 'get' ? http.get(path) : method === 'post' ? http.post(path) : http.delete(path));
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(404);
      expect(response.body.code, `${method.toUpperCase()} ${path}`).toBe(30001);
    }
  });

  it('POST /api/v1/sessions 是公共接口：未认证可到达，凭据错误返回 20003（mock 数据源）', async () => {
    // 契约 §3：20003 INVALID_CREDENTIALS → HTTP 401，但它是「公共接口可达后」的业务结果，
    // 与「未认证 20001（缺少令牌）」区分：这里能到达登录逻辑即证明路由未挂守卫。
    const response = await http
      .post('/api/v1/sessions')
      .send({ username: 'no-such-user', password: 'whatever' })
      .expect(401);
    expect(response.body.code).toBe(20003);
    // 不泄露账号存在性：错误信息固定
    expect(response.body.message).toBe('用户名或密码错误');
  });

  it('401 响应仍是契约包体且带 X-Request-Id', async () => {
    const response = await http.get('/api/v1/orders');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body).toMatchObject({ code: 20001 });
    expect(typeof response.body.message).toBe('string');
    expect(response.body).toHaveProperty('data');
  });
});

describe('实体注册守卫（回归：漏 forFeature 会让业务事务整体回滚）', () => {
  /**
   * `autoLoadEntities: true` **只加载 `forFeature` 注册过的实体**。
   * 若某实体被 `manager.insert/find` 使用却没注册，运行时会抛
   * 「No metadata for "X" was found」；由于该调用发生在事务内，整笔业务会回滚。
   *
   * 该缺陷曾在 S5 首轮出现：`AuditLog` 未注册 → **所有** `POST /orders` 失败
   * （数据库端到端 18/29 失败）。本用例把「实体清单 ↔ forFeature 注册」绑死。
   *
   * 判定方式只用公开 API：`forFeature` 会按 `getRepositoryToken(Entity)` 注册 provider，
   * 因此「能在容器里解析出 Repository」等价于「已注册」。
   */
  const ALL_ENTITIES = [
    AiQueryLog,
    Alert,
    AuditLog,
    Bom,
    Device,
    EquipmentLog,
    Material,
    MaterialBatch,
    ProcessRoute,
    Product,
    SaleOrder,
    SnTrace,
    SysUser,
    WorkOrder,
    WorkTask,
  ];

  it('src/entities 下的实体文件数量与守卫清单一致（新增实体必须同步本清单）', () => {
    const entitiesDir = fileURLToPath(new URL('../src/entities/', import.meta.url));
    const entityFiles = readdirSync(entitiesDir).filter((file) => file.endsWith('.entity.ts'));
    expect(entityFiles.length).toBe(ALL_ENTITIES.length);
  });

  it('每个实体都能在容器中解析出 Repository（即已通过 forFeature 注册）', () => {
    for (const entity of ALL_ENTITIES) {
      expect(
        () => app.get(getRepositoryToken(entity), { strict: false }),
        `${entity.name} 未在任何 TypeOrmModule.forFeature 中注册`,
      ).not.toThrow();
    }
  });
});


