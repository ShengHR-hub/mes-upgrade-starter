/** 审计日志响应 DTO —— 契约 §5.3 `Page(...)` 元素形状。 */
export interface AuditLogResponse {
  id: string;
  userId: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string | null;
}

/** AI 查询日志响应 DTO —— 契约 §5.3 `Page(...)` 元素形状。 */
export interface AiQueryLogResponse {
  id: string;
  userId: string | null;
  kind: string;
  question: string;
  sqlGenerated: string | null;
  answer: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: string;
  createdAt: string | null;
}

/** `GET /role-permissions` 响应 data —— 契约 §5.3（完整三角色）。 */
export interface RolePermissionsResponse {
  roles: Array<{ role: string; permissions: string[] }>;
}
