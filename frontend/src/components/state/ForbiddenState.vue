<script setup lang="ts">
/** 公共无权限态（403）。与「登录失效」严格区分。 */
import { Lock } from '@element-plus/icons-vue'
import { computed } from 'vue'

import { ROLE_LABELS } from '@/types/role'
import type { Role } from '@/types/role'

const props = withDefaults(
  defineProps<{
    /** 本页允许的角色；用于说明需要什么身份 */
    requiredRoles?: readonly Role[]
    text?: string
    minHeight?: string
  }>(),
  {
    requiredRoles: () => [],
    text: '当前身份没有访问该页面的权限。',
    minHeight: '160px',
  },
)

const roleHint = computed(() => {
  if (props.requiredRoles.length === 0) return ''
  return props.requiredRoles.map((role) => ROLE_LABELS[role]).join('、')
})
</script>

<template>
  <div class="state-block state-block--forbidden" :style="{ minHeight }" role="alert">
    <el-icon class="state-block__icon state-block__icon--warning"><Lock /></el-icon>
    <p class="state-block__text">{{ text }}</p>
    <p v-if="roleHint" class="state-block__hint">本页面允许的身份：{{ roleHint }}</p>
    <p class="state-block__hint state-block__hint--muted">
      前端菜单隐藏与路由拦截只用于界面引导，不能替代后端鉴权（契约 §5.1）。
    </p>
    <slot />
  </div>
</template>
