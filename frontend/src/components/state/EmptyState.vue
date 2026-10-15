<script setup lang="ts">
/** 公共空数据态：用于列表为空、或无业务数据的情形（不伪造占位数据） */
import { Box } from '@element-plus/icons-vue'

withDefaults(
  defineProps<{
    text?: string
    description?: string
    minHeight?: string
  }>(),
  {
    text: '暂无数据',
    description: '',
    minHeight: '160px',
  },
)
</script>

<template>
  <div class="state-block" :style="{ minHeight }">
    <el-icon class="state-block__icon"><Box /></el-icon>
    <p class="state-block__text">{{ text }}</p>
    <p v-if="description" class="state-block__hint">{{ description }}</p>
    <slot />
  </div>
</template>
