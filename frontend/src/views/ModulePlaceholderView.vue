<script setup lang="ts">
/**
 * 通用模块占位页。
 *
 * S4 阶段所有未实现模块共用本组件；S5 起只需在 `config/modules.ts` 里为对应
 * 模块补上 `component`，路由即自动切换到真实页面（无需改本文件）。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import NotImplementedState from '@/components/state/NotImplementedState.vue'
import { findModuleByKey, pageRolesOf } from '@/config/modules'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const appStore = useAppStore()

const moduleDefinition = computed(() => findModuleByKey(route.meta.moduleKey))

const requiredRoles = computed(() => {
  const definition = moduleDefinition.value
  return definition ? pageRolesOf(definition) : []
})
</script>

<template>
  <div class="mes-card">
    <NotImplementedState
      :module-title="route.meta.title"
      :code="route.meta.code"
      :summary="route.meta.summary"
      :planned-apis="route.meta.plannedApis ?? []"
      :required-roles="requiredRoles"
      :preview="appStore.skeletonPreview"
    />
  </div>
</template>
