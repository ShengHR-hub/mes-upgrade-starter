import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SysUser } from '../../entities/sys-user.entity.js';
import { TokenService } from '../../common/auth/token.service.js';
import { AuditModule } from '../audit/audit.module.js';

import { AuthService } from './auth.service.js';
import { LogsController } from './logs.controller.js';
import { LogsService } from './logs.service.js';
import { PasswordService } from './password.service.js';
import { SessionsController } from './sessions.controller.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * B9 认证与用户管理模块（契约 §5.1 / §5.3）。
 *
 * 路由：
 * - `POST /api/v1/sessions`（公共登录）
 * - `GET/POST /api/v1/users…`、`GET /api/v1/users/me`、`POST /api/v1/users/me/password-changes`
 * - `GET /api/v1/role-permissions`、`/api/v1/audit-logs`、`/api/v1/ai-query-logs`
 *
 * `forFeature([SysUser])`：登录 / 改密 / 用户管理均在该实体元数据上执行事务查询
 * （漏注册会在事务内抛 No metadata → 整笔回滚，由 route-registration e2e 守卫）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysUser]), AuditModule],
  controllers: [SessionsController, UsersController, LogsController],
  providers: [AuthService, UsersService, LogsService, PasswordService, TokenService],
  exports: [PasswordService, UsersService],
})
export class AuthModule {}
