import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

import { MODULE_GROUP_KEYS, MODULES, MODULE_GROUPS, groupedModules, pageRolesOf } from './modules'
import { routes } from '@/router/routes'

function layoutChildren(): RouteRecordRaw[] {
  const layout = routes.find((route) => route.path === '/' && Array.isArray(route.children))
  if (!layout?.children) throw new Error('未找到 AppLayout 的子路由')
  return layout.children
}

describe('模块配置 · 一致性', () => {
  it('key 唯一', () => {
    const keys = MODULES.map((module) => module.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('path 唯一且以 / 开头', () => {
    const paths = MODULES.map((module) => module.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) {
      expect(path.startsWith('/'), path).toBe(true)
    }
  })

  it('分组 key 合法且分组不重复', () => {
    const groupKeys = MODULE_GROUPS.map((group) => group.key)
    expect(new Set(groupKeys).size).toBe(groupKeys.length)
    expect([...groupKeys].sort()).toEqual([...MODULE_GROUP_KEYS].sort())
    for (const module of MODULES) {
      expect(groupKeys, `${module.key} 的分组`).toContain(module.group)
    }
  })

  it('每个模块都有标题、编号、说明与非空可见角色', () => {
    for (const module of MODULES) {
      expect(module.title.length, module.key).toBeGreaterThan(0)
      expect(module.code.length, module.key).toBeGreaterThan(0)
      expect(module.summary.length, module.key).toBeGreaterThan(0)
      expect(pageRolesOf(module).length, `${module.key} 的可见角色不应为空`).toBeGreaterThan(0)
    }
  })

  it('模块编号覆盖需求 B1～B12 与 F1～F3 的核心模块', () => {
    const codes = MODULES.map((module) => module.code)
    for (const code of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'F1', 'F2', 'F3']) {
      expect(codes, `缺少模块编号 ${code}`).toContain(code)
    }
  })
})

describe('路由表 · 由单一配置源派生', () => {
  it('子路由数量与模块数量一致', () => {
    expect(layoutChildren().length).toBe(MODULES.length)
  })

  it('每个子路由的 name / path / meta 与配置一致', () => {
    const children = layoutChildren()
    for (const module of MODULES) {
      const route = children.find((child) => child.name === module.key)
      expect(route, `缺少路由 ${module.key}`).toBeDefined()
      const expectedPath = module.path === '/' ? '' : module.path.replace(/^\//, '')
      expect(route!.path, module.key).toBe(expectedPath)
      expect(route!.meta?.title, module.key).toBe(module.title)
      expect(route!.meta?.requiresAuth, module.key).toBe(true)
      expect(route!.meta?.moduleKey, module.key).toBe(module.key)
      expect(route!.meta?.code, module.key).toBe(module.code)
      expect(route!.meta?.summary, module.key).toBe(module.summary)
      expect([...(route!.meta?.roles ?? [])].sort(), module.key).toEqual([...pageRolesOf(module)].sort())
    }
  })

  it('每个路由都有组件加载器（已实现模块用真实页面，其余用占位页）', () => {
    for (const child of layoutChildren()) {
      expect(child.component, `${String(child.name)} 缺少组件`).toBeDefined()
    }
  })

  it('提供 403 / 404 / 登录页与未知路径兜底', () => {
    const names = routes.map((route) => route.name)
    expect(names).toContain('login')
    expect(names).toContain('forbidden')
    expect(names).toContain('not-found')
    expect(names).toContain('not-found-catch-all')
    const catchAll = routes.find((route) => route.name === 'not-found-catch-all')
    expect(catchAll?.path).toBe('/:pathMatch(.*)*')
  })
})

describe('菜单分组', () => {
  it('未登录（骨架预览）返回全部模块', () => {
    const total = groupedModules(null).reduce((sum, entry) => sum + entry.modules.length, 0)
    expect(total).toBe(MODULES.length)
  })

  it('按角色过滤后只包含该角色可见模块', () => {
    for (const role of ['admin', 'manager', 'operator'] as const) {
      const modules = groupedModules(role).flatMap((entry) => entry.modules)
      for (const module of modules) {
        expect(pageRolesOf(module), `${role} 不应看到 ${module.key}`).toContain(role)
      }
      expect(modules.length).toBe(MODULES.filter((module) => pageRolesOf(module).includes(role)).length)
    }
  })

  it('operator 看不到用户与权限、审计日志', () => {
    const keys = groupedModules('operator').flatMap((entry) => entry.modules.map((module) => module.key))
    expect(keys).not.toContain('users')
    expect(keys).not.toContain('logs')
  })
})
