<script setup lang="ts">
/**
 * 数据来源标识（契约 §2.3）。
 *
 * 规则：
 * - `demo` → 显示「演示数据」（用响应里的 `dataLabel`，缺省回退为「演示数据」）；
 * - `enterprise-master` → 显示「企业主数据」，**不得标成演示流水**；
 * - `enterprise-documents` → 显示「企业文档」（RAG 知识来源）；
 * - 未知值 → 显示「来源未知」，不猜测；
 * - 未提供 → 不渲染（避免给真实主数据错误贴标）。
 */
import { computed } from 'vue'

import { DATA_SOURCE_LABELS, type DataSourceKind } from '@/types/api'

const props = withDefaults(
  defineProps<{
    dataSource?: string | null
    dataLabel?: string | null
  }>(),
  {
    dataSource: null,
    dataLabel: null,
  },
)

const KNOWN_KINDS: readonly DataSourceKind[] = ['demo', 'enterprise-master', 'enterprise-documents']

const kind = computed<DataSourceKind | null>(() => {
  const value = props.dataSource
  if (!value) return null
  return (KNOWN_KINDS as readonly string[]).includes(value) ? (value as DataSourceKind) : null
})

const unknownSource = computed(() => Boolean(props.dataSource) && kind.value === null)

const label = computed(() => {
  if (kind.value === null) return props.dataSource ?? ''
  if (kind.value === 'demo') return props.dataLabel ?? DATA_SOURCE_LABELS.demo
  return DATA_SOURCE_LABELS[kind.value]
})

const tagType = computed(() => {
  if (kind.value === 'demo') return 'warning'
  if (kind.value === 'enterprise-master') return 'success'
  if (kind.value === 'enterprise-documents') return 'info'
  return 'danger'
})

const tooltip = computed(() => {
  switch (kind.value) {
    case 'demo':
      return '基于企业真实主数据模拟生成的业务流水，非真实生产数据。'
    case 'enterprise-master':
      return '来自企业提供的主数据文件（产品 / 物料 / 设备等），未做模拟。'
    case 'enterprise-documents':
      return '来自企业文档知识库（RAG 引用来源）。'
    default:
      return '未识别的来源标识，请核对接口返回。'
  }
})
</script>

<template>
  <el-tooltip v-if="dataSource" :content="tooltip" placement="bottom" effect="dark">
    <el-tag :type="tagType" size="small" effect="light" class="data-source-tag">
      {{ unknownSource ? `来源未知（${label}）` : label }}
    </el-tag>
  </el-tooltip>
</template>

<style scoped>
.data-source-tag {
  vertical-align: middle;
}
</style>
