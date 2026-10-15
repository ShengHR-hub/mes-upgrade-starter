<script setup lang="ts">
/**
 * 请求号展示 + 复制。
 *
 * 用途：失败时保留响应头 `X-Request-Id`，供用户复制给开发排查
 * （S4 要求第 5 条）。不展示任何请求体、令牌或密码。
 */
import { CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'

const props = defineProps<{ requestId?: string | null }>()

const copyFailed = ref(false)

async function copy(): Promise<void> {
  const value = props.requestId
  if (!value) return
  copyFailed.value = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      copyFailed.value = true
    }
  } catch {
    copyFailed.value = true
  }
  if (copyFailed.value) {
    ElMessage({ type: 'warning', message: '当前浏览器不允许自动复制，请手动选中复制。', duration: 3000 })
    return
  }
  ElMessage({ type: 'success', message: '请求号已复制。', duration: 2000 })
}
</script>

<template>
  <div v-if="requestId" class="request-id">
    <span class="request-id__label">请求号（排查用）：</span>
    <code class="request-id__value">{{ requestId }}</code>
    <el-button link type="primary" size="small" @click="copy">
      <el-icon><CopyDocument /></el-icon>
      <span>复制</span>
    </el-button>
  </div>
</template>

<style scoped>
.request-id {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--mes-font-size-sm);
  color: var(--mes-text-secondary);
}

.request-id__value {
  font-family: var(--mes-font-mono);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--mes-fill-light);
  color: var(--mes-text-primary);
  word-break: break-all;
}
</style>
