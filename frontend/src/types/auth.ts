/**
 * 认证相关类型（契约 §5.1 / §5.3）。
 *
 * `POST /api/v1/sessions` 与 `GET /api/v1/users/me` 的真实会话类型。
 * （属 B9，S10 会话）。本文件仅冻结字段结构，不代表接口可用。
 */

import type { Id } from './api'
import type { Role } from './role'

/** POST /api/v1/sessions 请求体（契约 §5.3，字段严格一致） */
export interface LoginRequest {
  username: string
  password: string
}

/** 会话中的用户摘要（契约 §5.3 登录响应 user 字段） */
export interface SessionUser {
  id: Id
  username: string
  name: string
  role: Role
}

/** POST /api/v1/sessions 成功响应 data（契约 §5.3） */
export interface SessionResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresAt: string
  user: SessionUser
}

/** GET /api/v1/users/me 响应 data（契约 §5.3） */
export interface CurrentUser {
  id: Id
  username: string
  name: string
  dept: string | null
  post: string | null
  role: Role
  phone: string | null
  enabled: boolean
}
