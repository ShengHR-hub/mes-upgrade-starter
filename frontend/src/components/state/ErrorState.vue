<script setup lang="ts">
/**
 * 公共错误态。
 *
 * 按错误类型区分展示（S4 要求第 5 条）：
 * - 401（登录失效）/ 403（无权限）不混用；
 * - 404 / 参数错误 / 依赖不可用 / 超时分别给出对应文案；
 * - 保留 `X-Request-Id` 供复制排查。
 */
import { CircleCloseFilled } from '@element-plus/icons-vue'
import { computed } from 'vue'

import RequestIdNotice from '@/components/RequestIdNotice.vue'
import { describeApiError, toApiError, type ApiError } from '@/services/api-error'

const props = withDefaults(
  defineProps<{
    error: unknown
    title?: string
    minHeight?: string
    /** 是否展示重试按钮 */
    retryable?: boolean
  }>(),
  {
    title: '',
    minHeight: '160px',
    retryable: false,
  },
)

const emit = defineEmits<{ retry: [] }>()

const apiError = computed<ApiError>(() => toApiError(props.error))

const resolvedTitle = computed(() => {
  if (props.title) return props.title
  switch (apiError.value.kind) {
    case 'unauthenticated':
      return '登录状态已失效'
    case 'forbidden':
      return '无访问权限'
    case 'not-found':
      return '资源不存在'
    case 'timeout':
      return '请求超时'
    case 'network':
      return '无法连接到服务器'
    case 'dependency':
      return '依赖服务不可用'
    case 'invalid-argument':
      return '请求参数不合法'
    default:
      return '加载失败'
  }
})

const detail = computed(() => describeApiError(apiError.value))
</script>

<template>
  <div class="state-block state-block--error" :style="{ minHeight }" role="alert">
    <el-icon class="state-block__icon state-block__icon--error"><CircleCloseFilled /></el-icon>
    <p class="state-block__text">{{ resolvedTitle }}</p>
    <p class="state-block__hint">{{ detail }}</p>
    <ul v-if="apiError.fieldErrors.length > 0" class="state-block__fields">
      <li v-for="field in apiError.fieldErrors" :key="`${field.field}-${field.reason}`">
        <strong>{{ field.field }}</strong>：{{ field.reason }}
      </li>
    </ul>
    <RequestIdNotice :request-id="apiError.requestId" />
    <div v-if="retryable" class="state-block__actions">
      <el-button size="small" type="primary" @click="emit('retry')">重试</el-button>
    </div>
  </div>
</template>

<style scoped>
.state-block__fields {
  margin: 0;
  padding-left: 18px;
  text-align: left;
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
}
</style>
