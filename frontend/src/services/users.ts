/**
 * B9 用户与审计服务（契约 §5.3）。
 *
 * - 改密 / 用户管理 / 日志查询**只读或写入自身**；日志不提供修改删除；
 * - 令牌只在内存（见 stores/auth），不在本服务落盘；
 * - 三角色权限清单用于入口显隐对照，**不能替代后端授权**。
 */

import { httpGet, httpPatch, httpPost } from './http'
import { compactParams } from './params'

import type { PageResult } from '@/types/api'
import type {
  AiQueryLog,
  AiQueryLogListQuery,
  AuditLog,
  AuditLogListQuery,
  ChangePasswordPayload,
  CreateUserPayload,
  RolePermissions,
  UpdateUserPayload,
  User,
  UserListQuery,
  VoidResult,
} from '@/types/user'
import type { CurrentUser, LoginRequest, SessionResponse } from '@/types/auth'

export const usersService = {
  /** GET /api/v1/users —— 用户列表（仅 admin） */
  list(query: UserListQuery = {}, signal?: AbortSignal): Promise<PageResult<User>> {
    return httpGet<PageResult<User>>('/users', compactParams({ ...query }), { signal })
  },

  /** POST /api/v1/users —— 新建用户（仅 admin；Argon2id 哈希在服务端完成） */
  create(payload: CreateUserPayload, signal?: AbortSignal): Promise<User> {
    return httpPost<User>('/users', payload, { signal })
  },

  /** PATCH /api/v1/users/{id} —— 修改用户（仅 admin；最后 admin 保护） */
  update(id: string, payload: UpdateUserPayload, signal?: AbortSignal): Promise<User> {
    return httpPatch<User>(`/users/${encodeURIComponent(id)}`, payload, { signal })
  },
}

export const logsService = {
  /** GET /api/v1/audit-logs —— 操作审计日志（仅 admin，只读） */
  auditLogs(query: AuditLogListQuery = {}, signal?: AbortSignal): Promise<PageResult<AuditLog>> {
    return httpGet<PageResult<AuditLog>>('/audit-logs', compactParams({ ...query }), { signal })
  },

  /** GET /api/v1/ai-query-logs —— AI 查询日志（仅 admin，只读） */
  aiQueryLogs(
    query: AiQueryLogListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<AiQueryLog>> {
    return httpGet<PageResult<AiQueryLog>>('/ai-query-logs', compactParams({ ...query }), {
      signal,
    })
  },

  /** GET /api/v1/role-permissions —— 三角色权限清单（仅 admin） */
  rolePermissions(signal?: AbortSignal): Promise<RolePermissions> {
    return httpGet<RolePermissions>('/role-permissions', undefined, { signal })
  },
}

export const accountService = {
  /** POST /api/v1/sessions —— 登录（公共接口） */
  login(payload: LoginRequest, signal?: AbortSignal): Promise<SessionResponse> {
    return httpPost<SessionResponse>('/sessions', payload, { signal })
  },

  /** GET /api/v1/users/me —— 当前用户资料 */
  me(signal?: AbortSignal): Promise<CurrentUser> {
    return httpGet<CurrentUser>('/users/me', undefined, { signal })
  },

  /** POST /api/v1/users/me/password-changes —— 修改自身密码 */
  changePassword(payload: ChangePasswordPayload, signal?: AbortSignal): Promise<VoidResult> {
    return httpPost<VoidResult>('/users/me/password-changes', payload, { signal })
  },
}
