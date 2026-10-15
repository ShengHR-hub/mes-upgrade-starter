<script setup lang="ts">
/** 404 页面不存在。未知路径由路由兜底重定向到本页。 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { sanitizeRedirect } from '@/router/redirect'

const route = useRoute()

const fromPath = computed(() => sanitizeRedirect(route.query.from, ''))
</script>

<template>
  <div class="error-page">
    <el-result icon="info" title="404 · 页面不存在">
      <template #sub-title>
        <p>请求的地址不在本系统路由表中。</p>
        <p v-if="fromPath" class="error-page__from">
          原始地址：<code>{{ fromPath }}</code>
        </p>
      </template>
      <template #extra>
        <el-button type="primary" @click="$router.replace({ name: 'home' })">返回首页</el-button>
        <el-button @click="$router.replace({ name: 'login' })">返回登录页</el-button>
      </template>
    </el-result>
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
</style>
