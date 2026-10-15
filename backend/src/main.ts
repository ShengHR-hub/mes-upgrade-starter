import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // 契约 §4：NestJS 监听 3001；Vue 同源代理将 /api/v1 转发至此
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`MES backend 已启动：http://localhost:${port}`);
  logger.log(`健康检查：http://localhost:${port}/health （等价 /api/v1/health）`);
}

await bootstrap();
