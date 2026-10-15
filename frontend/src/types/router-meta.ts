import 'vue-router'

import type { Role } from './role'

/**
 * 路由 meta 的类型化声明。
 *
 * 这些字段全部由 `src/config/modules.ts`（单一配置源）派生，路由表、菜单、
 * 面包屑、页面标题与权限元数据都读同一份数据，避免多处复制后不一致。
 */
declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题（浏览器标题、面包屑末项、页头标题共用） */
    title: string
    /** 是否公开（无需登录） */
    public?: boolean
    /** 是否需要登录后访问 */
    requiresAuth?: boolean
    /** 可访问本页的角色集合（来自契约 §5.2 权限矩阵） */
    roles?: readonly Role[]
    /** 模块唯一 key，对应 config/modules.ts 的 ModuleDefinition.key */
    moduleKey?: string
    /** 所属菜单分组 key */
    groupKey?: string
    /** 模块编号（B1 / F2 ...） */
    code?: string
    /** 模块一句话说明 */
    summary?: string
    /** 该模块后续会使用的契约接口路径（仅展示用，不代表已实现） */
    plannedApis?: readonly string[]
    /** 是否已实现（S4 全部为 false，占位页） */
    implemented?: boolean
  }
}
