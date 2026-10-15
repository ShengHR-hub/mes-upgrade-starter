<script setup lang="ts">
/**
 * 公共「尚未实现」态。
 *
 * 硬性要求（S4 要求第 3 条）：占位页必须明确写「本模块尚未实现」，
 * **不放假列表、假统计、假成功提示，也不放可点击的业务提交按钮**。
 */
import { Tools } from '@element-plus/icons-vue'
import { computed } from 'vue'

import { ROLE_LABELS, type Role } from '@/types/role'

const props = withDefaults(
  defineProps<{
    moduleTitle?: string
    code?: string
    summary?: string
    plannedApis?: readonly string[]
    requiredRoles?: readonly Role[]
    /** 是否为骨架预览态（预览下不校验权限，需显式说明） */
    preview?: boolean
    minHeight?: string
  }>(),
  {
    moduleTitle: '',
    code: '',
    summary: '',
    plannedApis: () => [],
    requiredRoles: () => [],
    preview: false,
    minHeight: '220px',
  },
)

const roleText = computed(() =>
  props.requiredRoles.length === 0
    ? '已登录用户'
    : props.requiredRoles.map((role) => ROLE_LABELS[role]).join('、'),
)
</script>

<template>
  <div class="state-block state-block--pending" :style="{ minHeight }">
    <el-icon class="state-block__icon"><Tools /></el-icon>
    <p class="state-block__text">本模块尚未实现</p>
    <p class="state-block__hint">
      {{ moduleTitle ? `${moduleTitle}（${code}）` : '' }}
      {{ summary }}
    </p>

    <el-descriptions class="pending-meta" :column="1" size="small" border>
      <el-descriptions-item label="计划接口">
        <span v-if="plannedApis.length === 0">无（本页仅做导航）</span>
        <span v-else class="pending-apis">
          <code v-for="api in plannedApis" :key="api">{{ api }}</code>
        </span>
      </el-descriptions-item>
      <el-descriptions-item label="允许身份">{{ roleText }}</el-descriptions-item>
      <el-descriptions-item label="当前状态">
        {{ preview ? '骨架预览（未登录、未校验权限）' : '等待后续会话实现' }}
      </el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-if="preview"
      class="pending-alert"
      type="warning"
      :closable="false"
      show-icon
      title="骨架预览模式"
      description="预览仅用于检查布局与占位页：不建立登录态、不授予业务权限、不调用任何业务接口。页面上的权限说明来自契约 §5.2，预览下未做校验。"
    />

    <p class="state-block__hint state-block__hint--muted">
      本页不展示任何业务数据；列表、统计与操作按钮将在对应会话实现后接入。
    </p>
  </div>
</template>

<style scoped>
.pending-meta {
  max-width: 720px;
  width: 100%;
  text-align: left;
}

.pending-apis {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pending-apis code {
  font-family: var(--mes-font-mono);
  font-size: var(--mes-font-size-sm);
}

.pending-alert {
  max-width: 720px;
  text-align: left;
}
</style>
