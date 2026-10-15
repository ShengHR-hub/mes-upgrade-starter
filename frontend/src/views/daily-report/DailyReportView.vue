<script setup lang="ts">
/**
 * F2 AI 生产日报页面 —— 契约 §7.2。
 *
 * 核心功能与边界：
 * 1. 严格支持契约近 7 天窗口（Asia/Shanghai 时区），禁止选择范围外日期；
 * 2. 一键按需生成工厂级日报，四段固定（生产总览 / 产线表现 / 预警分析 / 改进建议）；
 * 3. 明确标注“演示数据”“报工良品率”“非真实FPY”、mode、degraded 及 snapshotAt；
 * 4. 预警原因与建议严格基于 alertId 关联，无预警时两数组为空；
 * 5. 模型输出作为不可信文本渲染（不使用 v-html）；
 * 6. useSubmitGuard 提交防抖与防并发，useAsyncTask 支持任务取消与轮次隔离。
 */
import {
  Calendar,
  Check,
  Close,
  DataLine,
  InfoFilled,
  Refresh,
  Warning,
} from '@element-plus/icons-vue'
import { computed, onMounted, ref } from 'vue'

import AiModeTag from '@/components/AiModeTag.vue'
import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import {
  DailyReportsService,
  type DailyReportResponse,
} from '@/services/daily-reports'
import { showWriteError } from '@/services/write-feedback'
import { formatNullableText, formatPercent } from '@/utils/format'

// ---------------------------------------------------------------- 日期计算
function getShanghaiToday(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return formatter.format(new Date())
  } catch {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

function shiftDateStr(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + offsetDays))
  const ry = date.getUTCFullYear()
  const rm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const rd = String(date.getUTCDate()).padStart(2, '0')
  return `${ry}-${rm}-${rd}`
}

const todayStr = getShanghaiToday()
const minAllowedDateStr = shiftDateStr(todayStr, -6)
const maxAllowedDateStr = todayStr

// 默认日期取今日
const selectedDate = ref(todayStr)

// 日期选择器限制近 7 天
function disabledDate(time: Date): boolean {
  const y = time.getFullYear()
  const m = String(time.getMonth() + 1).padStart(2, '0')
  const d = String(time.getDate()).padStart(2, '0')
  const current = `${y}-${m}-${d}`
  return current < minAllowedDateStr || current > maxAllowedDateStr
}

// ---------------------------------------------------------------- 异步任务与防抖
const reportTask = useAsyncTask<DailyReportResponse>()
const submitGuard = useSubmitGuard()

const report = computed(() => reportTask.data.value)
const isNoData = computed(() => report.value?.answerStatus === 'no_data')

function handleGenerate(): void {
  if (!selectedDate.value) return

  void submitGuard.run(async () => {
    try {
      await reportTask.run((signal) => {
        return DailyReportsService.generate(
          { date: selectedDate.value },
          signal,
        )
      })
    } catch (err: unknown) {
      showWriteError(err)
    }
  })
}

function handleCancel(): void {
  reportTask.cancel()
}

// 预警状态映射
function getAnalysisStatusTag(status: string): { label: string; type: 'success' | 'warning' | 'info' | 'danger' } {
  switch (status) {
    case 'hypothesis':
      return { label: '因果假设', type: 'warning' }
    case 'insufficient_evidence':
      return { label: '证据不足', type: 'info' }
    case 'no_anomaly':
      return { label: '未见异常', type: 'success' }
    default:
      return { label: status || '未知状态', type: 'info' }
  }
}

function getAlertLevelType(level: string): 'danger' | 'warning' | 'info' {
  if (level === '紧急') return 'danger'
  if (level === '重要') return 'warning'
  return 'info'
}

onMounted(() => {
  handleGenerate()
})
</script>

<template>
  <div class="daily-report-view">
    <!-- 顶部操作栏 -->
    <el-card class="action-card" shadow="never">
      <div class="action-bar">
        <div class="date-selector">
          <span class="label">日报日期：</span>
          <el-date-picker
            v-model="selectedDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期（近 7 天）"
            :disabled-date="disabledDate"
            :clearable="false"
            style="width: 180px"
          />
          <span class="date-hint">（契约约定仅支持近 7 天：{{ minAllowedDateStr }} ~ {{ maxAllowedDateStr }}）</span>
        </div>

        <div class="action-buttons">
          <el-button
            v-if="reportTask.loading.value"
            type="info"
            plain
            :icon="Close"
            @click="handleCancel"
          >
            取消请求
          </el-button>
          <el-button
            type="primary"
            :icon="Refresh"
            :loading="reportTask.loading.value || submitGuard.submitting.value"
            :disabled="!selectedDate"
            @click="handleGenerate"
          >
            生成生产日报
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 加载中状态 -->
    <div v-if="reportTask.loading.value" class="state-container">
      <LoadingState message="正在通过受控快照生成 AI 生产日报，请稍候…" />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="reportTask.error.value" class="state-container">
      <ErrorState
        :error="reportTask.error.value"
        title="生成日报失败"
        :retryable="true"
        @retry="handleGenerate"
      />
    </div>

    <!-- 成功展示四段式结构 -->
    <div v-else-if="report" class="report-content">
      <!-- 报告元数据标识栏 -->
      <div class="meta-banner">
        <div class="meta-left">
          <span class="report-title">工厂生产日报 · {{ report.date }}</span>
          <DataSourceTag :data-source="report.dataSource" :data-label="report.dataLabel" />
          <AiModeTag :mode="report.mode as any" :degraded="report.degraded" />
        </div>
        <div class="meta-right">
          <span class="snapshot-time">数据快照时刻：{{ report.snapshotAt }}</span>
        </div>
      </div>

      <!-- 无数据警告条 -->
      <el-alert
        v-if="isNoData"
        type="warning"
        :closable="false"
        show-icon
        class="no-data-alert"
      >
        <template #title>
          <span>当日无可用生产业务数据</span>
        </template>
        <template #default>
          <p>{{ report.overview.text }}</p>
        </template>
      </el-alert>

      <!-- 第一段：生产总览 (Overview) -->
      <el-card class="section-card" shadow="never">
        <template #header>
          <div class="section-header">
            <span class="section-title"><el-icon><DataLine /></el-icon> 一、生产总览</span>
            <span class="section-tag">权威聚合快照</span>
          </div>
        </template>

        <!-- 文本解读卡片（纯文本安全渲染） -->
        <div class="overview-text-box">
          <div class="overview-text-content">{{ report.overview.text }}</div>
        </div>

        <!-- 关键核心指标 KPI 卡片 -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">当日产出量</div>
            <div class="kpi-value">{{ formatNullableText(report.overview.outputQty) }} <span class="unit">件</span></div>
            <div class="kpi-sub">末道工序报工总量</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">当日良品数</div>
            <div class="kpi-value text-success">{{ formatNullableText(report.overview.goodQty) }} <span class="unit">件</span></div>
            <div class="kpi-sub">不良品：{{ formatNullableText(report.overview.badQty) }} 件</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">报工良品率</div>
            <div class="kpi-value" :class="{ 'text-warning': (report.overview.goodRate ?? 100) < 97 }">
              {{ formatPercent(report.overview.goodRate) }}
            </div>
            <div class="kpi-sub notice">报工良品率，非真实FPY</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">计划总数</div>
            <div class="kpi-value">{{ formatNullableText(report.overview.planTotalQty) }} <span class="unit">件</span></div>
            <div class="kpi-sub">当日计划：{{ formatNullableText(report.overview.planQty) }} 件</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">累计良品量</div>
            <div class="kpi-value">{{ formatNullableText(report.overview.doneQty) }} <span class="unit">件</span></div>
            <div class="kpi-sub">入选工单历史累计</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">累计完成率</div>
            <div class="kpi-value" :class="{ 'text-warning': (report.overview.completionRate ?? 100) < 90 }">
              {{ formatPercent(report.overview.completionRate) }}
            </div>
            <div class="kpi-sub">累计完成 / 计划总数</div>
          </div>
        </div>
      </el-card>

      <!-- 第二段：产线表现 (Line Performance) -->
      <el-card class="section-card" shadow="never">
        <template #header>
          <div class="section-header">
            <span class="section-title"><el-icon><Calendar /></el-icon> 二、产线表现</span>
            <span class="section-tag">分产线权威口径对比</span>
          </div>
        </template>

        <el-table
          :data="report.linePerformance"
          stripe
          border
          style="width: 100%"
          empty-text="暂无产线表现数据"
        >
          <el-table-column prop="prodLine" label="产线" min-width="120">
            <template #default="{ row }">
              <span class="line-name">{{ row.prodLine || '未分配产线' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="planQty" label="当日计划" width="100" align="right">
            <template #default="{ row }">{{ formatNullableText(row.planQty) }}</template>
          </el-table-column>
          <el-table-column prop="outputQty" label="当日产出" width="100" align="right">
            <template #default="{ row }">{{ formatNullableText(row.outputQty) }}</template>
          </el-table-column>
          <el-table-column prop="goodQty" label="良品数" width="100" align="right">
            <template #default="{ row }">{{ formatNullableText(row.goodQty) }}</template>
          </el-table-column>
          <el-table-column prop="badQty" label="不良数" width="100" align="right">
            <template #default="{ row }">{{ formatNullableText(row.badQty) }}</template>
          </el-table-column>
          <el-table-column prop="goodRate" label="报工良品率" width="130" align="right">
            <template #default="{ row }">
              <span :class="{ 'text-danger': row.goodRate !== null && row.goodRate < 97 }">
                {{ formatPercent(row.goodRate) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="planTotalQty" label="计划总数" width="110" align="right">
            <template #default="{ row }">{{ formatNullableText(row.planTotalQty) }}</template>
          </el-table-column>
          <el-table-column prop="doneQty" label="累计良品" width="110" align="right">
            <template #default="{ row }">{{ formatNullableText(row.doneQty) }}</template>
          </el-table-column>
          <el-table-column prop="completionRate" label="累计完成率" width="130" align="right">
            <template #default="{ row }">
              <span :class="{ 'text-warning': row.completionRate !== null && row.completionRate < 90 }">
                {{ formatPercent(row.completionRate) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 第三段：预警分析 (Alerts) -->
      <el-card class="section-card" shadow="never">
        <template #header>
          <div class="section-header">
            <span class="section-title"><el-icon><Warning /></el-icon> 三、预警原因分析 (F4 同源)</span>
            <span class="section-tag">基于受控事实证据链</span>
          </div>
        </template>

        <div v-if="report.alerts.length === 0" class="empty-box">
          <EmptyState message="当日无触发预警记录" />
        </div>

        <div v-else class="alerts-list">
          <div
            v-for="alert in report.alerts"
            :key="alert.alertId"
            class="alert-card"
          >
            <div class="alert-header">
              <div class="alert-title-row">
                <el-tag size="small" :type="getAlertLevelType(alert.type)">{{ alert.type }}</el-tag>
                <span class="alert-title-text">{{ alert.title }}</span>
                <span class="alert-id-badge">ID: {{ alert.alertId }}</span>
              </div>
              <el-tag size="small" :type="getAnalysisStatusTag(alert.analysisStatus).type" effect="plain">
                {{ getAnalysisStatusTag(alert.analysisStatus).label }}
              </el-tag>
            </div>

            <!-- 说明文本 -->
            <div v-if="alert.explanation" class="alert-explanation">
              <el-icon><InfoFilled /></el-icon>
              <span>{{ alert.explanation }}</span>
            </div>

            <!-- 可能原因列表及引用 -->
            <div v-if="alert.possibleCauses && alert.possibleCauses.length > 0" class="causes-container">
              <div class="sub-label">可能原因与依据：</div>
              <ul class="cause-list">
                <li v-for="(cause, cIdx) in alert.possibleCauses" :key="cIdx" class="cause-item">
                  <div class="cause-text">{{ cause.text }}</div>
                  <div v-if="cause.evidenceRefs && cause.evidenceRefs.length > 0" class="cause-refs">
                    <span class="ref-label">依据引用：</span>
                    <el-tag
                      v-for="ref in cause.evidenceRefs"
                      :key="ref"
                      size="small"
                      type="info"
                      class="ref-tag"
                    >
                      {{ ref }}
                    </el-tag>
                  </div>
                </li>
              </ul>
            </div>

            <!-- 针对性处置建议 -->
            <div v-if="alert.suggestion" class="suggestion-row">
              <span class="suggestion-label">建议处置：</span>
              <span class="suggestion-text">{{ alert.suggestion }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 第四段：改进建议 (Suggestions) -->
      <el-card class="section-card" shadow="never">
        <template #header>
          <div class="section-header">
            <span class="section-title"><el-icon><Check /></el-icon> 四、改进建议汇总</span>
            <span class="section-tag">关联预警明细</span>
          </div>
        </template>

        <div v-if="report.suggestions.length === 0" class="empty-box">
          <EmptyState message="当日无相关改进建议" />
        </div>

        <div v-else class="suggestions-grid">
          <div
            v-for="(sug, sIdx) in report.suggestions"
            :key="sIdx"
            class="suggestion-card"
          >
            <div class="sug-header">
              <span class="sug-idx">#{{ sIdx + 1 }}</span>
              <span class="sug-ref">关联预警 ID: {{ sug.alertId }}</span>
            </div>
            <div class="sug-body">{{ sug.text }}</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 初始空状态 -->
    <div v-else class="state-container">
      <EmptyState message="请选择日期并点击「生成生产日报」" />
    </div>
  </div>
</template>

<style scoped>
.daily-report-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.action-card {
  border-radius: 8px;
}

.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.date-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-selector .label {
  font-weight: 500;
  color: #303133;
}

.date-hint {
  font-size: 12px;
  color: #909399;
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

.report-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2d3d;
}

.snapshot-time {
  font-size: 12px;
  color: #606266;
}

.no-data-alert {
  margin-bottom: 8px;
}

.report-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  border-radius: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #303133;
}

.section-tag {
  font-size: 12px;
  color: #909399;
}

.overview-text-box {
  background: #f9fafc;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.overview-text-content {
  font-size: 14px;
  line-height: 1.6;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-all;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
}

.kpi-card {
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 14px;
  display: flex;
  flex-direction: column;
}

.kpi-label {
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  margin-bottom: 4px;
}

.kpi-value .unit {
  font-size: 12px;
  font-weight: normal;
  color: #909399;
}

.kpi-sub {
  font-size: 11px;
  color: #909399;
}

.kpi-sub.notice {
  color: #e6a23c;
}

.text-success {
  color: #67c23a;
}

.text-warning {
  color: #e6a23c;
}

.text-danger {
  color: #f56c6c;
}

.line-name {
  font-weight: 600;
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.alert-card {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 14px;
  background: #fafafa;
}

.alert-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.alert-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.alert-title-text {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.alert-id-badge {
  font-size: 11px;
  color: #909399;
  background: #f0f2f5;
  padding: 2px 6px;
  border-radius: 4px;
}

.alert-explanation {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #909399;
  margin-bottom: 10px;
  background: #ffffff;
  padding: 8px 12px;
  border-radius: 4px;
}

.causes-container {
  margin-bottom: 10px;
}

.sub-label {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 6px;
}

.cause-list {
  list-style: disc inside;
  padding-left: 4px;
  margin: 0;
}

.cause-item {
  font-size: 13px;
  color: #303133;
  margin-bottom: 6px;
}

.cause-refs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  margin-left: 18px;
}

.ref-label {
  font-size: 11px;
  color: #909399;
}

.ref-tag {
  font-family: monospace;
}

.suggestion-row {
  background: #f0f9eb;
  border-left: 3px solid #67c23a;
  padding: 8px 12px;
  border-radius: 0 4px 4px 0;
  font-size: 13px;
}

.suggestion-label {
  font-weight: 600;
  color: #67c23a;
}

.suggestion-text {
  color: #303133;
}

.suggestions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.suggestion-card {
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sug-idx {
  font-weight: 700;
  color: #409eff;
}

.sug-ref {
  font-size: 11px;
  color: #909399;
}

.sug-body {
  font-size: 13px;
  color: #303133;
  line-height: 1.5;
}

.empty-box,
.state-container {
  padding: 32px 0;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
