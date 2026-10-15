import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { AuthGuard } from './auth.guard.js';
import {
  IDENTITY_RESOLVER,
  NoAuthIdentityResolver,
  type IdentityResolver,
} from './identity-resolver.js';
import { JwtIdentityResolver } from './jwt-identity-resolver.js';
import { RolesGuard } from './roles.guard.js';
import { TokenService } from './token.service.js';

/**
 * 认证/授权模块（全局）。
 *
 * 身份解析绑定策略（S10 / B9）：
 * - 配置了合规 `JWT_SECRET`（≥32 字节随机，来自进程环境变量，不落盘）→ 绑定
 *   `JwtIdentityResolver`（真实 JWT 校验 + 每请求读当前 `sys_user.enabled/role`）；
 * - 未配置 / 不合规 → 绑定 `NoAuthIdentityResolver`（恒返回 null，fail-closed），
 *   所有业务接口保持 401，**不会**退化成任何客户端可控身份（请求体、自定义身份头、
 *   固定账号、前端预览角色均不被接受为身份）。
 *
 * 隔离测试仍可 `overrideProvider(IDENTITY_RESOLVER)` 注入身份替身 —— 替身只出现在
 * 测试注入路径，不进入正常启动路径（任务书 §七.1）。
 */
@Global()
@Module({
  providers: [
    TokenService,
    {
      provide: IDENTITY_RESOLVER,
      useFactory: (
        config: ConfigService,
        tokens: TokenService,
        dataSource: DataSource,
      ): IdentityResolver => {
        if (tokens.enabled) {
          return new JwtIdentityResolver(tokens, dataSource);
        }
        return new NoAuthIdentityResolver();
      },
      inject: [ConfigService, TokenService, DataSource],
    },
    AuthGuard,
    RolesGuard,
  ],
  exports: [IDENTITY_RESOLVER, TokenService, AuthGuard, RolesGuard],
})
export class AuthModule {}
