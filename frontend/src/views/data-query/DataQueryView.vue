<script setup lang="ts">
/**
 * F3 智能问数页面 —— 契约 §7.1。
 *
 * 核心功能与边界：
 * 1. 自然语言提问 → NestJS 受控查询 → 回答只转述受控数字（不含 FPY / OEE 编造）；
 * 2. 展示问题、回答、数据范围（指标/维度/日期/产线）、快照时刻与数据来源标识；
 * 3. 趋势结果保留日期与指标口径（报工良品率 / 累计完成率），逐日带数据状态；
 * 4. 支持加载、澄清、无数据、降级、错误与重试状态；不支持的问题给出澄清文案；
 * 5. 快速切换问题 / 连续提交时旧响应不得覆盖新结果（useAsyncTask 轮次隔离）；
 * 6. 页面离开自动取消在途请求；不向用户暴露内部 SQL、认证配置或调试信息；
 * 7. 模型文本按不可信内容渲染（不使用 v-html）。
 */
import { ChatDotRound, Close, InfoFilled, Search } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'

import AiModeTag from '@/components/AiModeTag.vue'
import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import {
  DataQueriesService,
  type QueryAnswerResponse,
} from '@/services/data-queries'
import { formatCalculationStatus, formatPercent } from '@/utils/format'
import { decideSubmit, type SubmitIdentity } from '@/utils/query-submit'

/** 契约 §7.1 示例问题（需求 §四 F3 原文，演示入口） */
const EXAMPLE_QUESTIONS: readonly string[] = [
  '今天哪条产线直通率最低？',
  '这周哪天不良品最多？',
  'SMT-2 线这周完成率趋势怎么样？',
  'CAL-1 线的主要不良原因是什么？',
]

/** 指标口径展示名（与后端白名单一致；不展示未支持口径） */
const METRIC_LABELS: Readonly<Record<string, string>> = {
  goodRate: '报工良品率',
  completionRate: '累计完成率',
  goodQty: '良品数量',
  badQty: '不良品数量',
  outputQty: '产出数量',
  defectQty: '不良数量',
  deviceStatus: '设备状态',
}

const GROUP_LABELS: Readonly<Record<string, string>> = {
  prodLine: '按产线',
  date: '按日期',
  defectType: '按不良类型',
  device: '按设备',
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  list: '列表',
  trend: '趋势',
  minimum: '最低',
  maximum: '最高',
}

const question = ref('')
const queryTask = useAsyncTask<QueryAnswerResponse>()

/**
 * 在途提交身份（S9 二轮审查修复）：**提交 token**（每次提交唯一 id）+
 * 提交时的问题快照。不用问题文本做身份——相同文本的两次查询是不同请求；
 * 取消时同步释放身份，不依赖底层 Promise 是否响应 AbortSignal。
 */
let submitSeq = 0
const inFlightSubmit = ref<SubmitIdentity | null>(null)

const result = computed(() => queryTask.data.value)
const isClarification = computed(() => result.value?.answerStatus === 'clarification_required')
const isNoData = computed(() => result.value?.answerStatus === 'no_data')
const isTrend = computed(() => result.value?.query?.groupBy === 'date')

/** 趋势场景追加「数据状态」列（契约 §7.1：每天有显式状态） */
const tableColumns = computed(() => {
  const columns = result.value?.columns ?? []
  const hasDataStatus = (result.value?.rows ?? []).some(
    (row) => row.dataStatus !== undefined,
  )
  if (!hasDataStatus) return columns
  return [...columns, { key: 'dataStatus', label: '数据状态', type: 'string' }]
})

function cellText(row: Record<string, unknown>, column: { key: string; unit?: string }): string {
  const value = row[column.key]
  if (value === null || value === undefined) return '暂无数据'
  if (column.key === 'dataStatus') return formatCalculationStatus(String(value))
  if (column.unit === '%' && typeof value === 'number') return formatPercent(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return String(value)
}

function formatFilterValue(value: unknown): string {
  if (value === true) return '是'
  if (value === false) return '否'
  return String(value)
}

function handleSubmit(): void {
  const text = question.value.trim()
  // 重复提交只在「同问题 + 确实在途」时成立（token 判等，非文本判等）
  if (decideSubmit(inFlightSubmit.value, text, queryTask.loading.value) === 'duplicate') return

  // 新请求：取消在途旧轮次并清空旧结果，防止旧响应覆盖新结果
  if (queryTask.loading.value) {
    queryTask.reset()
  }
  submitSeq += 1
  const token: SubmitIdentity = { id: submitSeq, question: text }
  inFlightSubmit.value = token

  void queryTask
    .run((signal) => DataQueriesService.query({ question: text }, signal))
    .catch(() => undefined)
    .finally(() => {
      // 按 token 判等释放身份：迟到/被取代的旧请求不会误清新的 token
      if (inFlightSubmit.value?.id === token.id) {
        inFlightSubmit.value = null
      }
    })
}

function handleAskExample(example: string): void {
  question.value = example
  handleSubmit()
}

function handleRetry(): void {
  handleSubmit()
}

function handleCancel(): void {
  // 取消必须**同步**释放提交身份：若底层 Promise 忽略 AbortSignal 永不 settle，
  // 仅靠 finally 清身份会让同一问题被永久误判为重复提交（二轮审查修复）。
  queryTask.cancel()
  inFlightSubmit.value = null
}
</script>

<template>
  <div class="data-query-view">
    <!-- 提问区 -->
    <el-card class="action-card" shadow="never">
      <div class="ask-bar">
        <el-input
          v-model="question"
          type="textarea"
          :rows="2"
          maxlength="2000"
          show-word-limit
          resize="none"
          placeholder="请输入生产数据问题，例如：今天哪条产线直通率最低？（支持报工良品率 / 累计完成率 / 良品数 / 不良数 / 产量 / 不良类型 / 设备状态）"
          @keyup.enter.exact.prevent="handleSubmit"
        />
        <div class="ask-actions">
          <el-button
            v-if="queryTask.loading.value"
            type="info"
            plain
            :icon="Close"
            @click="handleCancel"
          >
            取消请求
          </el-button>
          <el-button
            type="primary"
            :icon="Search"
            :loading="queryTask.loading.value"
            :disabled="!question.trim()"
            @click="handleSubmit"
          >
            提问
          </el-button>
        </div>
      </div>

      <div class="examples">
        <span class="examples-label">示例问题：</span>
        <el-tag
          v-for="example in EXAMPLE_QUESTIONS"
          :key="example"
          class="example-tag"
          effect="plain"
          :disable-transitions="false"
          @click="handleAskExample(example)"
        >
          {{ example }}
        </el-tag>
      </div>
    </el-card>

    <!-- 加载中 -->
    <div v-if="queryTask.loading.value" class="state-container">
      <LoadingState message="正在解析问题并执行受控查询，请稍候…" />
    </div>

    <!-- 错误 -->
    <div v-else-if="queryTask.error.value" class="state-container">
      <ErrorState
        :error="queryTask.error.value"
        title="问数请求失败"
        :retryable="true"
        @retry="handleRetry"
      />
    </div>

    <!-- 结果 -->
    <div v-else-if="result" class="result-content">
      <!-- 元数据标识栏 -->
      <div class="meta-banner">
        <div class="meta-left">
          <span class="result-title"><el-icon><ChatDotRound /></el-icon> 问数结果</span>
          <DataSourceTag :data-source="result.dataSource" :data-label="result.dataLabel" />
          <AiModeTag :mode="result.mode as any" :degraded="result.degraded" />
        </div>
        <div class="meta-right">
          <span class="snapshot-time">数据快照时刻：{{ result.snapshotAt }}</span>
        </div>
      </div>

      <!-- 澄清提示 -->
      <el-alert
        v-if="isClarification"
        type="warning"
        :closable="false"
        show-icon
        class="result-alert"
      >
        <template #title>
          <span>需要补充说明</span>
        </template>
        <template #default>
          <p>{{ result.clarification ?? result.answer }}</p>
        </template>
      </el-alert>

      <!-- 无数据提示 -->
      <el-alert
        v-else-if="isNoData"
        type="info"
        :closable="false"
        show-icon
        class="result-alert"
      >
        <template #title>
          <span>无可用数据</span>
        </template>
        <template #default>
          <p>{{ result.answer }}</p>
        </template>
      </el-alert>

      <!-- 已回答 -->
      <template v-else>
        <el-card class="answer-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">回答</span>
              <span v-if="result.query" class="section-tag">
                口径：{{ METRIC_LABELS[result.query.metric] ?? result.query.metric }}
                ／ {{ GROUP_LABELS[result.query.groupBy] ?? result.query.groupBy }}
                ／ {{ OPERATION_LABELS[result.query.operation] ?? result.query.operation }}
                ／ {{ result.query.startDate }} ~ {{ result.query.endDate }}
                <template v-if="result.query.prodLine">／ 产线 {{ result.query.prodLine }}</template>
              </span>
            </div>
          </template>
          <div class="answer-text">{{ result.answer }}</div>
          <p class="answer-note">
            <el-icon><InfoFilled /></el-icon>
            数字来自受控业务查询（演示数据）；报工良品率不等同于真实 FPY，本版不提供 OEE。
          </p>
        </el-card>

        <el-card class="table-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">{{ isTrend ? '逐日数据（趋势）' : '查询数据' }}</span>
              <span class="section-tag">null 表示已知缺失，不改为 0</span>
            </div>
          </template>

          <el-alert
            v-if="result.degraded"
            type="warning"
            :closable="false"
            show-icon
            class="degraded-alert"
          >
            <template #title>
              <span>回答由本地规则生成（模型润色不可用），数字与受控查询一致</span>
            </template>
          </el-alert>

          <el-table
            :data="result.rows"
            stripe
            border
            style="width: 100%"
            empty-text="暂无数据"
          >
            <el-table-column
              v-for="column in tableColumns"
              :key="column.key"
              :prop="column.key"
              :label="column.label"
              min-width="110"
              align="right"
            >
              <template #default="{ row }">
                <span
                  :class="{
                    'text-danger':
                      typeof row[column.key] === 'number' &&
                      column.unit === '%' &&
                      column.key === 'goodRate' &&
                      (row[column.key] as number) < 97,
                    'text-warning':
                      typeof row[column.key] === 'number' &&
                      column.unit === '%' &&
                      column.key === 'completionRate' &&
                      (row[column.key] as number) < 90,
                  }"
                >
                  {{ cellText(row, column) }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="result.sources.length > 0" class="source-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">数据来源</span>
              <span class="section-tag">受控查询范围</span>
            </div>
          </template>
          <ul class="source-list">
            <li v-for="(source, idx) in result.sources" :key="idx">
              <el-tag size="small" type="info" effect="plain">{{ source.resource }}</el-tag>
              <span class="source-filters">
                <template v-if="source.filters">
                  <em
                    v-for="(value, key) in source.filters"
                    :key="String(key)"
                    class="filter-chip"
                  >
                    {{ key }}={{ formatFilterValue(value) }}
                  </em>
                </template>
                <span v-else>无附加过滤</span>
              </span>
            </li>
          </ul>
        </el-card>
      </template>
    </div>

    <!-- 初始空状态 -->
    <div v-else class="state-container">
      <EmptyState message="请输入问题或点击上方示例问题开始问数" />
    </div>
  </div>
</template>

<style scoped>
.data-query-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.action-card {
  border-radius: 8px;
}

.ask-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.ask-bar .el-textarea {
  flex: 1;
}

.ask-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.examples {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.examples-label {
  font-size: 13px;
  color: #606266;
}

.example-tag {
  cursor: pointer;
}

.example-tag:hover {
  opacity: 0.85;
}

.state-container {
  padding: 32px 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.result-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.meta-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f4f6f8;
  padding: 12px 16px;
  border-radius: 8px;
  border-left: 4px solid #409eff;
}

.meta-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2d3d;
  display: flex;
  align-items: center;
  gap: 6px;
}

.snapshot-time {
  font-size: 12px;
  color: #606266;
}

.result-alert {
  border-radius: 8px;
}

.answer-card,
.table-card,
.source-card {
  border-radius: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.section-tag {
  font-size: 12px;
  color: #909399;
}

.answer-text {
  font-size: 14px;
  line-height: 1.7;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-all;
}

.answer-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0;
  font-size: 12px;
  color: #e6a23c;
}

.degraded-alert {
  margin-bottom: 12px;
}

.source-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.source-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-chip {
  font-style: normal;
  font-size: 12px;
  color: #606266;
  background: #f0f2f5;
  border-radius: 4px;
  padding: 2px 6px;
  margin-right: 6px;
}

.source-filters {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.text-warning {
  color: #e6a23c;
}

.text-danger {
  color: #f56c6c;
}
</style>
