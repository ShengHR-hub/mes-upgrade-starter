/**
 * B9 用户、权限与日志类型（契约 §5.3）。
 *
 * ⚠️ 这些类型**绝不包含 password_hash**（契约 §5.1）。
 */

import type { DataSourceMeta, PaginationQuery } from './api'
import type { Role } from './role'

/** 用户资料（GET /users、/users/me、POST /users、PATCH /users/{id}） */
export interface User {
  id: string
  username: string
  name: string
  dept: string | null
  post: string | null
  role: Role
  phone: string | null
  enabled: boolean
}

export interface UserListQuery extends PaginationQuery {
  role?: Role
  enabled?: boolean
  keyword?: string
}

export interface CreateUserPayload {
  username: string
  name: string
  password: string
  role: Role
  dept?: string
  post?: string
  phone?: string
}

export interface UpdateUserPayload {
  name?: string
  dept?: string | null
  post?: string | null
  phone?: string | null
  role?: Role
  enabled?: boolean
}

/** 三角色权限清单 */
export interface RolePermissions {
  roles: Array<{ role: Role; permissions: string[] }>
}

/** 操作审计日志（只读） */
export interface AuditLog {
  id: string
  userId: string | null
  action: string
  target: string | null
  detail: string | null
  ip: string | null
  createdAt: string | null
}

export interface AuditLogListQuery extends PaginationQuery {
  userId?: string
  action?: string
  startDate?: string
  endDate?: string
}

/** AI 查询日志（只读） */
export interface AiQueryLog {
  id: string
  userId: string | null
  kind: string
  question: string
  sqlGenerated: string | null
  answer: string | null
  tokensIn: number
  tokensOut: number
  latencyMs: number
  status: string
  createdAt: string | null
}

export interface AiQueryLogListQuery extends PaginationQuery {
  userId?: string
  kind?: string
  status?: string
  startDate?: string
  endDate?: string
}

/** 登录响应（契约 §5.3） */
export interface LoginResult {
  accessToken: string
  tokenType: 'Bearer'
  expiresAt: string
  user: {
    id: string
    username: string
    name: string
    role: Role
  }
}

/** 改密载荷 */
export interface ChangePasswordPayload {
  oldPassword: string
  newPassword: string
}

/** 空 data 响应（改密成功返回 data:null） */
export type VoidResult = null

export type { DataSourceMeta }
