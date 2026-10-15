/**
 * 认证服务（契约 §5.1 / §5.3）。
 *
 * 后端会话接口由 B9/S10 提供真实 JWT：
 * - `POST /api/v1/sessions`
 * - `GET /api/v1/users/me`
 *
 * 因此本文件只做「按契约字段发起真实请求」，不做任何降级或伪造：
 * 未实现时后端会返回 404 / code 30001，前端如实提示，**不生成假 JWT、
 * 不硬编码账号密码、不宣称登录成功**。
 *
 * 密码只在调用栈中传递，不写入 store、不打印、不落盘。
 */

import { httpGet, httpPost } from './http'

import type { CurrentUser, LoginRequest, SessionResponse } from '@/types/auth'

export const authService = {
  /** 登录：字段严格对应契约 §5.3 `{ username, password }` */
  login(payload: LoginRequest, signal?: AbortSignal): Promise<SessionResponse> {
    return httpPost<SessionResponse>('/sessions', payload, { signal })
  },

  /** 当前用户资料（预留；契约 §5.3） */
  me(signal?: AbortSignal): Promise<CurrentUser> {
    return httpGet<CurrentUser>('/users/me', undefined, { signal })
  },
}
