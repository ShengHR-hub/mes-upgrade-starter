<script setup lang="ts">
/**
 * AI 模式 / 降级状态标识 —— **本轮预留，未接入任何 AI 功能**。
 *
 * 契约 §3：`mode:"local"`、`degraded:true` 表示 LLM 不可用但本地模式仍可回答；
 * 不能把 FastAPI 整体不可达误标成「LLM 降级成功」。
 *
 * 该组件供 S8/S9 直接复用，S4 不调用。
 */
import { computed } from 'vue'

import { AI_MODE_LABELS, type AiMode } from '@/types/ai'

const props = withDefaults(
  defineProps<{
    mode?: AiMode | null
    degraded?: boolean | null
  }>(),
  {
    mode: null,
    degraded: null,
  },
)

const label = computed(() => {
  if (!props.mode) return null
  const base = AI_MODE_LABELS[props.mode]
  return props.degraded ? `${base}（已降级）` : base
})

const tagType = computed(() => {
  if (!props.mode) return 'info'
  return props.degraded ? 'warning' : 'info'
})
</script>

<template>
  <el-tag v-if="label" :type="tagType" size="small" effect="plain">{{ label }}</el-tag>
</template>
