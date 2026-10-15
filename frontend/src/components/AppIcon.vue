<script setup lang="ts">
/**
 * 图标映射：只引入实际用到的图标，避免整包图标进入产物。
 * 图标名与 `config/modules.ts` 的 IconName 一一对应。
 */
import {
  Bell,
  Box,
  ChatLineSquare,
  DataAnalysis,
  Document,
  Files,
  HomeFilled,
  Memo,
  Monitor,
  Notebook,
  PieChart,
  Promotion,
  Reading,
  ShoppingCart,
  Stopwatch,
  Tickets,
  User,
} from '@element-plus/icons-vue'
import { computed, type Component } from 'vue'

import type { IconName } from '@/config/modules'

const ICON_MAP: Readonly<Record<IconName, Component>> = {
  home: HomeFilled,
  order: Tickets,
  'work-order': Document,
  report: Stopwatch,
  inspection: Files,
  dashboard: DataAnalysis,
  alert: Bell,
  spc: PieChart,
  'daily-report': Memo,
  'data-query': ChatLineSquare,
  knowledge: Reading,
  material: Box,
  trace: Promotion,
  mrp: ShoppingCart,
  device: Monitor,
  user: User,
  log: Notebook,
}

const props = defineProps<{ name: IconName }>()

const icon = computed<Component>(() => ICON_MAP[props.name] ?? Document)
</script>

<template>
  <component :is="icon" />
</template>
