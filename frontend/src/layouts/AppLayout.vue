<script setup lang="ts">
/**
 * 应用主布局。
 *
 * - 左侧：分组菜单（可折叠；窄屏整体收起并可叠加展开）
 * - 顶部：项目名称 + 当前页面标题 + 面包屑 + 当前用户区
 * - 主区：骨架预览横幅（如启用）+ 页面标题区 + 路由出口
 *
 * 菜单项来自 `config/modules.ts` 单一配置源，与面包屑、页面标题同源。
 */
import { Expand, Fold } from '@element-plus/icons-vue'
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import AuthUserArea from '@/components/AuthUserArea.vue'
import SkeletonPreviewBanner from '@/components/SkeletonPreviewBanner.vue'
import { useViewport } from '@/composables/useViewport'
import { APP_NAME, APP_SUBTITLE } from '@/config/app'
import { findModuleByKey, groupedModules } from '@/config/modules'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

import { resolveAsideWidth, resolveMenuCollapsed, resolveOverlayBackdrop, shouldAutoCollapseOnEnterNarrow } from './layout'

const route = useRoute()
const appStore = useAppStore()
const authStore = useAuthStore()
const { isNarrow } = useViewport()

// 仅「宽 → 窄」时自动收起侧栏（边沿触发，避免瞬时 resize 误折叠 / 覆盖用户操作）
watch(isNarrow, (narrow, previous) => {
  if (shouldAutoCollapseOnEnterNarrow(previous, narrow)) appStore.setSidebarCollapsed(true)
})

/** 未登录（骨架预览）时不做角色过滤，由横幅与占位页显式说明未校验权限 */
const menuGroups = computed(() => groupedModules(authStore.role))

const layoutInput = computed(() => ({ isNarrow: isNarrow.value, collapsed: appStore.sidebarCollapsed }))

const menuCollapsed = computed(() => resolveMenuCollapsed(layoutInput.value))

const asideWidth = computed(() => resolveAsideWidth(layoutInput.value))

const showOverlayBackdrop = computed(() => resolveOverlayBackdrop(layoutInput.value))

const activeMenu = computed(() => route.path)

const pageTitle = computed(() => route.meta.title ?? APP_NAME)

const pageSummary = computed(() => route.meta.summary ?? '')

interface Crumb {
  title: string
  to?: string
}

const breadcrumbs = computed<Crumb[]>(() => {
  const current = findModuleByKey(route.meta.moduleKey)
  if (!current) {
    return [{ title: route.meta.title ?? '页面' }]
  }
  if (current.key === 'home') {
    return [{ title: current.title }]
  }
  return [{ title: '首页', to: '/' }, { title: current.title }]
})

function onMenuSelect(): void {
  if (isNarrow.value) appStore.setSidebarCollapsed(true)
}
</script>

<template>
  <div class="app-layout">
    <div v-if="showOverlayBackdrop" class="app-backdrop" @click="appStore.setSidebarCollapsed(true)" />

    <aside
      class="app-aside"
      :class="{ 'is-overlay': isNarrow, 'is-collapsed': menuCollapsed }"
      :style="{ width: asideWidth }"
    >
      <div class="app-brand">
        <span class="app-brand__mark">JC</span>
        <span v-show="!menuCollapsed" class="app-brand__text">
          <strong>{{ APP_NAME }}</strong>
          <small>{{ APP_SUBTITLE }}</small>
        </span>
      </div>

      <el-scrollbar class="app-aside__scroll">
        <el-menu
          :default-active="activeMenu"
          :collapse="menuCollapsed"
          :collapse-transition="false"
          router
          unique-opened
          @select="onMenuSelect"
        >
          <el-sub-menu v-for="entry in menuGroups" :key="entry.group.key" :index="entry.group.key">
            <template #title>
              <el-icon><AppIcon :name="entry.group.icon" /></el-icon>
              <span>{{ entry.group.title }}</span>
            </template>
            <el-menu-item v-for="item in entry.modules" :key="item.key" :index="item.path">
              <el-icon><AppIcon :name="item.icon" /></el-icon>
              <template #title>{{ item.title }}</template>
            </el-menu-item>
          </el-sub-menu>
        </el-menu>
      </el-scrollbar>
    </aside>

    <div class="app-body">
      <header class="app-header">
        <div class="app-header__row">
          <div class="app-header__left">
            <el-button
              text
              class="app-header__toggle"
              :aria-label="appStore.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
              @click="appStore.toggleSidebar()"
            >
              <el-icon>
                <Expand v-if="appStore.sidebarCollapsed" />
                <Fold v-else />
              </el-icon>
            </el-button>
            <span class="app-header__project">{{ APP_NAME }}</span>
            <el-divider direction="vertical" />
            <h1 class="app-header__title">{{ pageTitle }}</h1>
          </div>
          <div class="app-header__right">
            <AuthUserArea />
          </div>
        </div>

        <div class="app-header__row app-header__row--crumbs">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item
              v-for="(crumb, index) in breadcrumbs"
              :key="`${crumb.title}-${index}`"
              :to="crumb.to"
            >
              {{ crumb.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
      </header>

      <main class="app-main">
        <SkeletonPreviewBanner v-if="appStore.skeletonPreview" />

        <div class="page-header">
          <h2 class="page-header__title">{{ pageTitle }}</h2>
          <p v-if="pageSummary" class="page-header__subtitle">{{ pageSummary }}</p>
        </div>

        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  background: var(--mes-bg-page);
}

.app-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgba(0, 0, 0, 0.35);
}

.app-aside {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--mes-bg-aside);
  border-right: 1px solid var(--mes-border-color-light);
  transition: width 0.2s ease;
}

.app-aside.is-overlay {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1600;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.16);
}

.app-brand {
  display: flex;
  align-items: center;
  gap: var(--mes-space-2);
  height: 56px;
  padding: 0 var(--mes-space-3);
  border-bottom: 1px solid var(--mes-border-color-light);
  overflow: hidden;
}

.app-brand__mark {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mes-radius);
  background: var(--el-color-primary);
  color: #fff;
  font-weight: 700;
  font-size: var(--mes-font-size-sm);
}

.app-brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  white-space: nowrap;
}

.app-brand__text small {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-xs);
}

.app-aside__scroll {
  flex: 1 1 auto;
}

.app-aside :deep(.el-menu) {
  border-right: none;
}

.app-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: var(--mes-bg-container);
  border-bottom: 1px solid var(--mes-border-color-light);
  padding: var(--mes-space-3) var(--mes-space-4) var(--mes-space-2);
}

.app-header__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mes-space-3);
  flex-wrap: wrap;
}

.app-header__row--crumbs {
  margin-top: var(--mes-space-2);
}

.app-header__left {
  display: flex;
  align-items: center;
  gap: var(--mes-space-2);
  min-width: 0;
}

.app-header__project {
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
  white-space: nowrap;
}

.app-header__title {
  margin: 0;
  font-size: var(--mes-font-size-xl);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-header__right {
  display: flex;
  align-items: center;
  gap: var(--mes-space-2);
}

.app-main {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--mes-space-4);
}

@media (max-width: 768px) {
  .app-header__project {
    display: none;
  }

  .app-main {
    padding: var(--mes-space-3);
  }
}
</style>
