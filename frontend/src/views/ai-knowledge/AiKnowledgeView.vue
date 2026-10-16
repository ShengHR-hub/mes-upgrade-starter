<script setup lang="ts">
/**
 * F1 企业知识问答页面 —— 契约 §7.3。
 *
 * 核心功能与边界：
 * 1. 自然语言提问 → NestJS 代理 → FastAPI RAG（knowledge.json 检索，本地规则/可选模型）；
 * 2. 答案带引用来源（sourceName / chunkId / relevance / excerpt），超纲问题明确拒答；
 * 3. 设备/产品编号类问题走确定性引用，并附「资料记载、不代表实时状态」说明（由后端保证）；
 * 4. 支持加载、无依据、降级、错误与重试状态；不向用户暴露内部 SQL / 认证配置；
 * 5. 答案文本按不可信内容渲染（不使用 v-html）。
 */
import { ChatDotRound, Close, Document, InfoFilled, Search } from '@element-plus/icons-vue'
import { computed, onMounted, ref } from 'vue'

import AiModeTag from '@/components/AiModeTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import {
  KnowledgeService,
  type KnowledgeSourcesPageResponse,
  type RagAnswerResponse,
} from '@/services/knowledge'

/** 演示示例问题（面向企业资料：设备 / 产品 / 工艺 / 人员） */
const EXAMPLE_QUESTIONS: readonly string[] = [
  'EQP-SMT-006 是什么设备？',
  'JC-PLC-2001 的工艺路线有哪些工序？',
  'MES 系统要解决哪些生产管理痛点？',
  '质检员的岗位职责是什么？',
]

const question = ref('')
const askTask = useAsyncTask<RagAnswerResponse>()
const sourcesTask = useAsyncTask<KnowledgeSourcesPageResponse>()

const result = computed(() => askTask.data.value)
const isNotFound = computed(() => result.value?.answerStatus === 'not_found')
const citations = computed(() => result.value?.citations ?? [])

function formatRelevance(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function handleSubmit(): void {
  const text = question.value.trim()
  if (!text) return
  if (askTask.loading.value) {
    askTask.reset()
  }
  void askTask.run((signal) => KnowledgeService.answer({ question: text }, signal)).catch(() => undefined)
}

function handleAskExample(example: string): void {
  question.value = example
  handleSubmit()
}

function handleRetry(): void {
  handleSubmit()
}

function handleCancel(): void {
  askTask.cancel()
}

onMounted(() => {
  void sourcesTask.run((signal) => KnowledgeService.listSources({ page: 1, pageSize: 50 }, signal)).catch(() => undefined)
})
</script>

<template>
  <div class="knowledge-view">
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
          placeholder="请输入企业知识问题，例如：EQP-SMT-006 是什么设备？（资料中没有的信息会明确拒答）"
          @keyup.enter.exact.prevent="handleSubmit"
        />
        <div class="ask-actions">
          <el-button
            v-if="askTask.loading.value"
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
            :loading="askTask.loading.value"
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
          @click="handleAskExample(example)"
        >
          {{ example }}
        </el-tag>
      </div>
    </el-card>

    <!-- 加载中 -->
    <div v-if="askTask.loading.value" class="state-container">
      <LoadingState message="正在检索企业知识库，请稍候…" />
    </div>

    <!-- 错误 -->
    <div v-else-if="askTask.error.value" class="state-container">
      <ErrorState
        :error="askTask.error.value"
        title="知识问答请求失败"
        :retryable="true"
        @retry="handleRetry"
      />
    </div>

    <!-- 空态 -->
    <div v-else-if="!result" class="state-container">
      <EmptyState
        title="还没有提问"
        description="基于企业资料（需求背景文档与 6 份企业数据）回答；资料中没有的信息会明确告知。"
      />
    </div>

    <!-- 结果 -->
    <template v-else>
      <el-card class="answer-card" shadow="never">
        <template #header>
          <div class="answer-header">
            <span class="answer-title">
              <el-icon><ChatDotRound /></el-icon>
              回答
            </span>
            <span class="answer-tags">
              <AiModeTag :mode="result.mode" :degraded="result.degraded" />
              <el-tag v-if="result.answerStatus === 'answered'" type="success" size="small" effect="plain">
                有依据
              </el-tag>
              <el-tag v-else type="info" size="small" effect="plain">无依据（拒答）</el-tag>
            </span>
          </div>
        </template>

        <div class="answer-text">{{ result.answer }}</div>

        <el-alert
          v-if="isNotFound && result.reason"
          class="reason-alert"
          type="info"
          :closable="false"
          show-icon
          title="拒答原因"
          :description="result.reason"
        />

        <el-alert
          v-if="result.degraded"
          class="degraded-alert"
          type="warning"
          :closable="false"
          show-icon
          title="模型调用降级"
          description="模型调用失败或超时，已回退本地检索模式；答案仅基于知识库检索结果。"
        />

        <div v-if="citations.length" class="citations">
          <div class="citations-title">
            <el-icon><Document /></el-icon>
            引用来源（{{ citations.length }}）
          </div>
          <el-collapse>
            <el-collapse-item
              v-for="(citation, index) in citations"
              :key="citation.chunkId"
              :title="`${index + 1}. ${citation.sourceName}（${citation.chunkId}）`"
              :name="index"
            >
              <div class="citation-meta">
                相关度：{{ formatRelevance(citation.relevance) }}
              </div>
              <div v-if="citation.excerpt" class="citation-excerpt">{{ citation.excerpt }}</div>
            </el-collapse-item>
          </el-collapse>
        </div>

        <div class="answer-footnote">
          <el-icon><InfoFilled /></el-icon>
          设备与产品信息为知识库资料记载，不代表实时状态；知识库更新需重新生成，不支持运行时上传。
        </div>
      </el-card>
    </template>

    <!-- 知识来源清单 -->
    <el-card class="sources-card" shadow="never">
      <template #header>
        <div class="sources-header">
          <span>知识来源清单</span>
          <span v-if="sourcesTask.data.value" class="sources-total">
            共 {{ sourcesTask.data.value.total }} 个来源 / {{ sourcesTask.data.value.chunkTotal }} 个知识块
          </span>
        </div>
      </template>
      <div v-if="sourcesTask.loading.value">
        <LoadingState message="正在加载知识来源…" />
      </div>
      <div v-else-if="sourcesTask.error.value">
        <ErrorState :error="sourcesTask.error.value" title="知识来源加载失败" />
      </div>
      <el-table v-else-if="sourcesTask.data.value?.list.length" :data="sourcesTask.data.value.list" size="small">
        <el-table-column prop="sourceName" label="来源" min-width="220" />
        <el-table-column prop="chunkCount" label="知识块数" width="100" align="right" />
        <el-table-column label="数据标识" width="180">
          <template #default="{ row }">{{ row.dataSource || '—' }}</template>
        </el-table-column>
      </el-table>
      <EmptyState v-else title="暂无知识来源" />
    </el-card>
  </div>
</template>

<style scoped>
.knowledge-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ask-bar {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.ask-bar :deep(.el-textarea) {
  flex: 1;
}

.ask-actions {
  display: flex;
  gap: 8px;
  padding-top: 2px;
}

.examples {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.examples-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.example-tag {
  cursor: pointer;
}

.state-container {
  padding: 8px 0;
}

.answer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.answer-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.answer-tags {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.answer-text {
  white-space: pre-wrap;
  line-height: 1.7;
  font-size: 14px;
}

.reason-alert,
.degraded-alert {
  margin-top: 12px;
}

.citations {
  margin-top: 16px;
}

.citations-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 8px;
}

.citation-meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-bottom: 4px;
}

.citation-excerpt {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.answer-footnote {
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.sources-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sources-total {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
