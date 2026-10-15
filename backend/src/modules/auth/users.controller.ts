import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/identity.types.js';
import { RequireRoles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

import { AuthService } from './auth.service.js';
import { ChangePasswordDto } from './dto/login.dto.js';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto.js';
import { UsersService } from './users.service.js';

function clientIp(request: Request): string | null {
  const value = request.ip;
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 45) : null;
}

/**
 * 用户与自身资料接口 —— 契约 §5.3。
 *
 * 权限（契约 §5.2）：
 * - `GET /users/me`、`POST /users/me/password-changes` → 已登录三角色（第 2 行）；
 * - `GET/POST/PATCH /users` → 仅 admin（第 23 行）。
 *
 * ⚠️ 普通用户不能借自身资料接口修改 role/enabled：契约只开放「读自身 + 改自身密码」，
 * 本控制器**不存在** `PATCH /users/me`。
 */
@Controller('api/v1/users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  /** GET /api/v1/users —— 用户列表（仅 admin） */
  @Get()
  @RequireRoles('admin')
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  /** POST /api/v1/users —— 新建用户（仅 admin；Argon2id 哈希；201） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles('admin')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.users.create(dto, { userId: user.id, ip: clientIp(request) });
  }

  /** PATCH /api/v1/users/{id} —— 修改用户（仅 admin；最后 admin 并发保护） */
  @Patch(':id')
  @RequireRoles('admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.users.update(id, dto, { userId: user.id, ip: clientIp(request) });
  }

  /** GET /api/v1/users/me —— 当前用户资料（身份来自令牌，非客户端） */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  /**
   * POST /api/v1/users/me/password-changes —— 修改自身密码。
   *
   * 旧密码不符 → 20003；新密码结构性约束（强度策略待 Q4-3 批准）；
   * 审计同事务，detail 不含口令/哈希。
   */
  @Post('me/password-changes')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.auth.changePassword(user.id, dto, { ip: clientIp(request) });
  }
}
