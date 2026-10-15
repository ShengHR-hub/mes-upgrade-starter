import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { LoginDto } from './dto/login.dto.js';
import { AuthService } from './auth.service.js';

/**
 * 登录接口 —— 契约 §5.3 `POST /api/v1/sessions`。
 *
 * **公共接口**（契约 §5.2 第 1 行）：不挂 AuthGuard / RolesGuard。
 *
 * - 账号须 enabled；失败统一 20003（不泄露账号存在性）；
 * - 成功返回访问 JWT（HS256、2 小时、iss=mes-backend、aud=mes-web，Q4-1 批准口径）；
 * - 请求体 password 只在调用栈中传递，不写日志、不落盘（契约 §5.1）。
 */
@Controller('api/v1/sessions')
export class SessionsController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() _request: Request) {
    return this.auth.login(dto);
  }
}
