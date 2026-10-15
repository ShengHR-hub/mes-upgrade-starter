/**
 * 布局尺寸规则（纯函数，便于单测）。
 *
 * 与 `styles/variables.css` 的 `--mes-aside-width` / `--mes-aside-collapsed-width`
 * 保持一致；断点与 `composables/useViewport.ts` 的 768px 一致。
 *
 * 三种形态：
 * - 桌面展开：220px
 * - 桌面折叠：64px（仅图标）
 * - 窄屏（<768px）：默认 0（整体隐藏），展开时为 220px 的浮层并带遮罩
 */

export const ASIDE_WIDTH_PX = 220
export const ASIDE_COLLAPSED_WIDTH_PX = 64
export const NARROW_BREAKPOINT_PX = 768

export interface AsideLayoutInput {
  isNarrow: boolean
  collapsed: boolean
}

export function resolveAsideWidth({ isNarrow, collapsed }: AsideLayoutInput): string {
  if (isNarrow) return collapsed ? '0px' : `${ASIDE_WIDTH_PX}px`
  return collapsed ? `${ASIDE_COLLAPSED_WIDTH_PX}px` : `${ASIDE_WIDTH_PX}px`
}

/** el-menu 是否进入图标折叠态（窄屏下不做图标态，而是整体隐藏/浮层展开） */
export function resolveMenuCollapsed({ isNarrow, collapsed }: AsideLayoutInput): boolean {
  return !isNarrow && collapsed
}

/** 窄屏展开侧栏时是否需要遮罩 */
export function resolveOverlayBackdrop({ isNarrow, collapsed }: AsideLayoutInput): boolean {
  return isNarrow && !collapsed
}

/**
 * 是否应当因「刚进入窄屏」而自动收起侧栏。
 *
 * 采用**边沿触发**（仅在 宽→窄 时动作），避免：
 * - 反复的 resize 事件在窄屏下不断覆盖用户手动展开的操作；
 * - 瞬时误报（如全页截图引起的临时尺寸变化）在宽屏下把侧栏折叠。
 */
export function shouldAutoCollapseOnEnterNarrow(previousNarrow: boolean, nextNarrow: boolean): boolean {
  return nextNarrow && !previousNarrow
}
