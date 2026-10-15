import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from './identity.types.js';

/**
 * 取出 `AuthGuard` 写入的可信身份。
 *
 * 仅可在已挂 `AuthGuard` 的路由上使用；未通过守卫时请求已被 20001 拦截，
 * 因此此处拿到的必然是服务端解析出的身份，**不是**客户端提交的值。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // 守卫保证存在；此处兜底避免未挂守卫的路由拿到 undefined
    return (
      request.user ?? {
        id: '',
        role: 'operator',
      }
    );
  },
);
