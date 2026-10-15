/**
 * 界面状态。
 *
 * 骨架预览（skeleton preview）与正式认证**完全分离**：
 * - 进入预览不会建立认证状态、不会授予任何业务权限、不会调用业务接口；
 * - 预览态仅存内存，刷新即失效（默认关闭）；
 * - 生产构建中 `SKELETON_PREVIEW_AVAILABLE` 恒为 false，不可通过查询参数绕过。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

import { SKELETON_PREVIEW_AVAILABLE } from '@/config/skeleton-preview'

export const useAppStore = defineStore('app', () => {
  /** 侧栏折叠（桌面端为图标态；窄屏为整体隐藏） */
  const sidebarCollapsed = ref(false)

  /** 骨架预览是否已进入（内存态，不持久化） */
  const skeletonPreview = ref(false)

  /** 当前构建是否允许骨架预览（开发环境显式开启时才为 true） */
  const skeletonPreviewAvailable = ref(SKELETON_PREVIEW_AVAILABLE)

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setSidebarCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
  }

  /** 进入骨架预览；不可用时返回 false，调用方须提示原因 */
  function enterSkeletonPreview(): boolean {
    if (!SKELETON_PREVIEW_AVAILABLE) return false
    skeletonPreview.value = true
    return true
  }

  function exitSkeletonPreview(): void {
    skeletonPreview.value = false
  }

  return {
    sidebarCollapsed,
    skeletonPreview,
    skeletonPreviewAvailable,
    toggleSidebar,
    setSidebarCollapsed,
    enterSkeletonPreview,
    exitSkeletonPreview,
  }
})
