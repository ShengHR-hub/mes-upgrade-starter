/**
 * 骨架预览开关（S4 要求第 4 条）。
 *
 * 规则（逐条对应要求）：
 * 1. 默认关闭 —— 变量缺省或非字符串 "true" 时不启用；
 * 2. 仅开发环境显式开启 —— 必须同时满足 `import.meta.env.DEV`（vite dev）与
 *    `VITE_ENABLE_SKELETON_PREVIEW === 'true'`；
 * 3. 生产构建不可用 —— `vite build` 会把 `import.meta.env.DEV` 静态替换为 `false`，
 *    因此无论环境变量为何值都不启用（已实测，见交接文档）；
 * 4. 不可用查询参数绕过 —— 本模块只读环境变量，不读取 URL / localStorage，
 *    预览态仅存在于内存中的 `stores/app.ts`，刷新即失效。
 */

const FLAG_VALUE = import.meta.env.VITE_ENABLE_SKELETON_PREVIEW
const IS_DEV_BUILD = import.meta.env.DEV === true

/** 是否允许在当前构建中启用骨架预览 */
export const SKELETON_PREVIEW_AVAILABLE: boolean = IS_DEV_BUILD && FLAG_VALUE === 'true'

/** 供界面说明使用（不包含任何敏感信息） */
export const SKELETON_PREVIEW_FLAG_DESCRIPTION =
  '由开发环境变量 VITE_ENABLE_SKELETON_PREVIEW 控制；生产构建中始终不可用。'
