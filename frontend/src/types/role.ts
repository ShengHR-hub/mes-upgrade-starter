/**
 * 角色定义（契约 §5.2）。
 *
 * 本版仅授权 admin / manager / operator 三个角色，不再按岗位或车间细分
 * （契约 §1「已确认」第 3 条、§10.1）。
 *
 * 注意：前端角色判断只用于「菜单可见性 + 路由守卫 + 操作入口显隐」，
 * **不能替代后端鉴权**（契约 §5.1：「前端路由隐藏不是鉴权」）。
 */

export const ROLES = ['admin', 'manager', 'operator'] as const

export type Role = (typeof ROLES)[number]

/** 界面展示用名称（对应需求规格说明书 §五 的企业岗位） */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: '管理员（厂长）',
  manager: '业务管理（计划 / 车间）',
  operator: '操作员 / 质检 / 仓库',
}

export const ROLE_SHORT_LABELS: Readonly<Record<Role, string>> = {
  admin: '管理员',
  manager: '业务管理',
  operator: '操作员',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
