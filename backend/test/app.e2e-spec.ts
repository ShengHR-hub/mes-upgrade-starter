import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
type App = any;
import { configureApp } from './../src/bootstrap.js';
import { HealthController } from './../src/modules/health/health.controller.js';
import { HealthService } from './../src/modules/health/health.service.js';

/**
 * 健康检查 + 全局规范 e2e —— 用 mock DataSource 替代真实数据库，保证测试不依赖 MySQL。
 * 真实连通性验证见交接文档 s2-backend-skeleton.md 的 curl 记录。
 */

type QueryMock = (sql: string) => Promise<unknown>;

const healthyQuery: QueryMock = async (sql) =>
  sql.includes('VERSION') ? [{ version: '8.4.9' }] : [{ ok: 1 }];

const failingQuery: QueryMock = async () => {
  throw new Error('connect ECONNREFUSED 127.0.0.1:3306');
};

/** 仅用于 e2e 的抛错控制器：验证 5xx 安全文案。 */
@Controller('__e2e-boom')
class BoomController {
  @Get()
  boom(): never {
    throw new Error(
      'INTERNAL_MARKER_SHOULD_NOT_LEAK :: dsn=mysql://root:secret@127.0.0.1:3306/smart_mes',
    );
  }
}

async function createApp(query: QueryMock): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [HealthController, BoomController],
    providers: [HealthService, { provide: getDataSourceToken(), useValue: { query } }],
  }).compile();

  const app: INestApplication<App> = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('Health (e2e)', () => {
  describe('数据库可用', () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
      app = await createApp(healthyQuery);
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /health 返回 code 0 且 database.status=up', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({ code: 0, message: '成功' });
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.database).toMatchObject({ status: 'up', version: '8.4.9' });
    });

    it('GET /api/v1/health 返回 code 0', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.database.status).toBe('up');
    });

    it('响应头带 X-Request-Id（含 404）', async () => {
      const ok = await request(app.getHttpServer()).get('/health').expect(200);
      expect(ok.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]{1,128}$/);

      const notFound = await request(app.getHttpServer()).get('/api/v1/unknown').expect(404);
      expect(notFound.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    });

    it('未知路径返回 404 / code 30001，且文案为契约中文标准文案', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/unknown').expect(404);
      expect(res.body).toEqual({ code: 30001, message: '资源不存在', data: null });
    });

    it('timestamp 使用业务时区 +08:00', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.data.timestamp).toMatch(/\+08:00$/);
    });

    it('未知查询字段被拒绝：/health?unexpectedField=1 → 400 / code 10001', async () => {
      const res = await request(app.getHttpServer())
        .get('/health?unexpectedField=1')
        .expect(400);
      expect(res.body.code).toBe(10001);
      expect(res.body.message).toBe('参数错误');
      expect(res.body.data.errors).toEqual([
        { field: 'unexpectedField', reason: '未知字段，请求被拒绝' },
      ]);
    });
  });

  describe('数据库不可用', () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
      app = await createApp(failingQuery);
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /health 返回 503 / code 50002，且不泄露原始错误', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(503);
      expect(res.body.code).toBe(50002);
      expect(res.body.message).toBe('依赖服务不可用');
      expect(res.body.data.database.status).toBe('down');
      expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    });
  });

  describe('未捕获异常（5xx 安全文案）', () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
      app = await createApp(healthyQuery);
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /__e2e-boom → 500 / code 50001 / message 为安全文案，且不含内部标记', async () => {
      const res = await request(app.getHttpServer()).get('/__e2e-boom').expect(500);
      expect(res.body).toEqual({ code: 50001, message: '服务器内部错误', data: null });
      expect(JSON.stringify(res.body)).not.toContain('INTERNAL_MARKER_SHOULD_NOT_LEAK');
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });
  });
});
