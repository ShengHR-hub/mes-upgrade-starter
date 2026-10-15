import { describe, expect, it } from 'vitest'

import {
  ASIDE_COLLAPSED_WIDTH_PX,
  ASIDE_WIDTH_PX,
  NARROW_BREAKPOINT_PX,
  resolveAsideWidth,
  resolveMenuCollapsed,
  resolveOverlayBackdrop,
  shouldAutoCollapseOnEnterNarrow,
} from './layout'
import { NARROW_BREAKPOINT_PX as VIEWPORT_BREAKPOINT } from '@/composables/useViewport'

describe('布局尺寸规则', () => {
  it('桌面展开为 220px，折叠为 64px', () => {
    expect(resolveAsideWidth({ isNarrow: false, collapsed: false })).toBe(`${ASIDE_WIDTH_PX}px`)
    expect(resolveAsideWidth({ isNarrow: false, collapsed: true })).toBe(`${ASIDE_COLLAPSED_WIDTH_PX}px`)
  })

  it('窄屏默认整体隐藏（0px），展开时为 220px 浮层', () => {
    expect(resolveAsideWidth({ isNarrow: true, collapsed: true })).toBe('0px')
    expect(resolveAsideWidth({ isNarrow: true, collapsed: false })).toBe(`${ASIDE_WIDTH_PX}px`)
  })

  it('窄屏不使用图标折叠态', () => {
    expect(resolveMenuCollapsed({ isNarrow: true, collapsed: true })).toBe(false)
    expect(resolveMenuCollapsed({ isNarrow: true, collapsed: false })).toBe(false)
    expect(resolveMenuCollapsed({ isNarrow: false, collapsed: true })).toBe(true)
    expect(resolveMenuCollapsed({ isNarrow: false, collapsed: false })).toBe(false)
  })

  it('仅窄屏展开时出现遮罩', () => {
    expect(resolveOverlayBackdrop({ isNarrow: true, collapsed: false })).toBe(true)
    expect(resolveOverlayBackdrop({ isNarrow: true, collapsed: true })).toBe(false)
    expect(resolveOverlayBackdrop({ isNarrow: false, collapsed: false })).toBe(false)
  })

  it('断点与 useViewport 保持一致', () => {
    expect(NARROW_BREAKPOINT_PX).toBe(VIEWPORT_BREAKPOINT)
    expect(NARROW_BREAKPOINT_PX).toBe(768)
  })
})

describe('自动收起侧栏 · 边沿触发', () => {
  it('仅在 宽 → 窄 时收起', () => {
    expect(shouldAutoCollapseOnEnterNarrow(false, true)).toBe(true)
  })

  it('持续处于窄屏时不重复动作（不覆盖用户手动展开）', () => {
    expect(shouldAutoCollapseOnEnterNarrow(true, true)).toBe(false)
  })

  it('窄 → 宽 或宽屏内的瞬时误报都不动作（防瞬时 resize 误折叠）', () => {
    expect(shouldAutoCollapseOnEnterNarrow(true, false)).toBe(false)
    expect(shouldAutoCollapseOnEnterNarrow(false, false)).toBe(false)
  })
})
