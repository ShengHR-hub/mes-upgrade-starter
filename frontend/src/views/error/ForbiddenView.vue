<script setup lang="ts">
/**
 * 403 无访问权限页。
 *
 * 与「登录失效」严格区分：403 表示已认证但角色不允许（契约 §3 错误码 20004）。
 */
import { Lock } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { sanitizeRedirect } from '@/router/redirect'
import { useAuthStore } from '@/stores/auth'
import { ROLE_LABELS } from '@/types/role'

const route = useRoute()
const authStore = useAuthStore()

const fromPath = computed(() => sanitizeRedirect(route.query.from, ''))
const currentRoleLabel = computed(() => (authStore.role ? ROLE_LABELS[authStore.role] : null))
</script>

<template>
  <div class="error-page">
    <el-result icon="warning" title="403 · 无访问权限">
      <template #sub-title>
        <p>当前身份不允许访问该页面。</p>
        <p v-if="fromPath" class="error-page__from">
          被拦截的地址：<code>{{ fromPath }}</code>
        </p>
        <p v-if="currentRoleLabel" class="error-page__from">
          当前身份：<strong>{{ currentRoleLabel }}</strong>
        </p>
      </template>
      <template #extra>
        <el-button type="primary" @click="$router.replace({ name: 'home' })">返回首页</el-button>
        <el-button @click="$router.replace({ name: 'login' })">返回登录页</el-button>
      </template>
    </el-result>

    <p class="error-page__note">
      <el-icon><Lock /></el-icon>
      提示：页面菜单隐藏与路由拦截只用于界面引导；真正的权限判定由后端负责（契约 §5.1、§5.2）。
    </p>
  </div>
</template>

<style scoped>
.error-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--mes-space-5);
  background: var(--mes-bg-page);
  text-align: center;
}

.error-page__from {
  margin: 4px 0 0;
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
}

.error-page__from code {
  font-family: var(--mes-font-mono);
}

.error-page__note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 640px;
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
}
</style>
