/**
 * 视口宽度监听：窄屏下侧栏整体收起（S4 要求第 2 条）。
 *
 * 加固点：resize 事件做 **去抖**（默认 150ms）。
 * 原因：全页截图、开发者工具、窗口动画等会触发瞬时 resize，
 * 若不防抖会让界面在「窄屏/宽屏」之间误翻转（实测复现：一次 fullPage 截图即把侧栏
 * 永久折叠成图标态）。
 */

import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** 窄屏断点（与 styles/index.css 的媒体查询、layouts/layout.ts 保持一致） */
export const NARROW_BREAKPOINT_PX = 768

/** resize 去抖窗口（毫秒） */
export const RESIZE_DEBOUNCE_MS = 150

export interface ViewportState {
  isNarrow: Ref<boolean>
}

export function useViewport(
  breakpointPx: number = NARROW_BREAKPOINT_PX,
  debounceMs: number = RESIZE_DEBOUNCE_MS,
): ViewportState {
  const isNarrow = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function update(): void {
    if (typeof window === 'undefined') return
    isNarrow.value = window.innerWidth < breakpointPx
  }

  function onResize(): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      update()
    }, debounceMs)
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', onResize)
  })

  onUnmounted(() => {
    if (timer !== null) clearTimeout(timer)
    window.removeEventListener('resize', onResize)
  })

  return { isNarrow }
}
