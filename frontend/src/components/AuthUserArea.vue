<script setup lang="ts">
/**
 * 当前用户区。
 *
 * 硬性要求（S4 要求第 2 条）：认证未接入时必须诚实显示「认证模块待接入」，
 * **不得展示虚构的已登录用户或「管理员已登录」**。
 */
import { ArrowDown, UserFilled } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { AUTH_PENDING_TEXT, SKELETON_PREVIEW_TEXT } from '@/config/app'
import { showApiError, showInfo } from '@/services/notify'
import { accountService } from '@/services/users'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { ROLE_SHORT_LABELS } from '@/types/role'

const authStore = useAuthStore()
const appStore = useAppStore()
const router = useRouter()

const state = computed<'authenticated' | 'preview' | 'anonymous'>(() => {
  if (authStore.isAuthenticated) return 'authenticated'
  if (appStore.skeletonPreview) return 'preview'
  return 'anonymous'
})

const roleLabel = computed(() => (authStore.role ? ROLE_SHORT_LABELS[authStore.role] : ''))

function exitPreview(): void {
  appStore.exitSkeletonPreview()
  showInfo('已退出骨架预览。')
  void router.push({ name: 'login' })
}

/** 拉取当前用户资料（GET /users/me）；失败时如实提示，不清除会话 */
async function loadProfile(): Promise<void> {
  try {
    const profile = await accountService.me()
    authStore.setProfile(profile)
    showInfo('用户资料已刷新。')
  } catch (error) {
    showApiError(error)
  }
}

function logout(): void {
  // 令牌仅在内存，清空即失效；不预设刷新/吊销方案（契约 §5.1、Q4 待定）
  authStore.clearSession()
  showInfo('已清除本地登录状态。')
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="auth-area">
    <template v-if="state === 'authenticated'">
      <el-dropdown trigger="click">
        <span class="auth-area__trigger">
          <el-icon class="auth-area__avatar"><UserFilled /></el-icon>
          <span class="auth-area__name">{{ authStore.displayName ?? authStore.username ?? '已登录用户' }}</span>
          <el-tag size="small" type="info" effect="plain">{{ roleLabel }}</el-tag>
          <el-icon><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>{{ authStore.username ?? '—' }}</el-dropdown-item>
            <el-dropdown-item @click="loadProfile">刷新用户资料</el-dropdown-item>
            <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>

    <template v-else-if="state === 'preview'">
      <el-tag type="warning" effect="dark" size="small">{{ SKELETON_PREVIEW_TEXT }}</el-tag>
      <el-button link type="primary" size="small" @click="exitPreview">退出预览</el-button>
    </template>

    <template v-else>
      <el-tag type="info" effect="plain" size="small">未登录</el-tag>
      <span class="auth-area__pending">{{ AUTH_PENDING_TEXT }}</span>
    </template>
  </div>
</template>

<style scoped>
.auth-area {
  display: flex;
  align-items: center;
  gap: var(--mes-space-2);
  white-space: nowrap;
}

.auth-area__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--mes-text-primary);
}

.auth-area__avatar {
  font-size: 18px;
}

.auth-area__name {
  font-weight: 600;
}

.auth-area__pending {
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
}
</style>
