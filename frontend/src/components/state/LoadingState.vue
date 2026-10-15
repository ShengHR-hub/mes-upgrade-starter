<script setup lang="ts">
/** 公共加载态 */
import { Loading } from '@element-plus/icons-vue'

withDefaults(defineProps<{ text?: string; minHeight?: string }>(), {
  text: '正在加载…',
  minHeight: '160px',
})
</script>

<template>
  <div class="state-block" :style="{ minHeight }" role="status" aria-live="polite">
    <el-icon class="state-block__icon is-spin"><Loading /></el-icon>
    <p class="state-block__text">{{ text }}</p>
  </div>
</template>

<style scoped>
.is-spin {
  animation: state-spin 1.1s linear infinite;
}

@keyframes state-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
