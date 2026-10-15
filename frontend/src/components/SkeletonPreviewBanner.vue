<script setup lang="ts">
/**
 * 骨架预览横幅。
 *
 * 必须显著标注「骨架预览，未登录」，并说明它不建立登录态、
 * 不授予业务权限、不调用业务接口（S4 要求第 4 条）。
 */
import { WarningFilled } from '@element-plus/icons-vue'

import { SKELETON_PREVIEW_FLAG_DESCRIPTION } from '@/config/skeleton-preview'
import { SKELETON_PREVIEW_TEXT } from '@/config/app'
</script>

<template>
  <el-alert
    class="skeleton-banner"
    type="warning"
    :closable="false"
    show-icon
    :title="SKELETON_PREVIEW_TEXT"
  >
    <template #default>
      <div class="skeleton-banner__body">
        <p>
          当前为<strong>骨架预览</strong>：仅用于检查布局、菜单与占位页。
          它<strong>没有建立登录状态</strong>、<strong>没有授予任何业务权限</strong>，
          也<strong>不会调用任何业务接口</strong>（仅公开的运维健康检查）。
        </p>
        <p class="skeleton-banner__meta">{{ SKELETON_PREVIEW_FLAG_DESCRIPTION }}</p>
      </div>
    </template>
    <template #icon>
      <el-icon><WarningFilled /></el-icon>
    </template>
  </el-alert>
</template>

<style scoped>
.skeleton-banner {
  margin-bottom: var(--mes-space-4);
}

.skeleton-banner__body p {
  margin: 0 0 4px;
  line-height: 1.6;
}

.skeleton-banner__meta {
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
}
</style>
