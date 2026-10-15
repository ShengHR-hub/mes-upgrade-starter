<script setup lang="ts">
/**
 * B10 预警中心页面 —— 契约 §6.9。
 *
 * 核心功能：
 * - 已持久化预警的契约化列表、详情及组合筛选；
 * - 预警状态候选流转：未处理 → 已确认 → 已关闭（Q6 边界防护：直接关闭/重开待 Q6 批准）；
 * - 权限控制：仅 admin / manager 角色可查看与流转（operator 拒绝）；
 * - 详细展示数据来源标识（demo 演示数据）与关联对象说明；
 * - 防护机制：useSubmitGuard 提交防抖与防并发，useAsyncTask 轮次隔离与取消。
 */
import {
  Bell,
  InfoFilled,
  Refresh,
  Search,
  View,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import AiModeTag from '@/components/AiModeTag.vue'
import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import {
  AlertsService,
  type Alert,
  type AlertStateTransitionPayload,
  type RootCauseAnalysisResponse,
} from '@/services/alerts'
import { showWriteError } from '@/services/write-feedback'
import { useAuthStore } from '@/stores/auth'
import type { PageResult } from '@/types/api'

const router = useRouter()
const authStore = useAuthStore()

// 仅管理员具有发起 F4 根因分析权限（契约 §5.2 第 17 行）
const isAdmin = computed(() => authStore?.role === 'admin')

// Q6-4 预警状态流转闭环处于“待决策”状态，未获批前前端关闭流转入口（保留 authStore 供后续 Q6 开放）
const canTransition = computed(() => {
  return Boolean(authStore && false)
})

// ---------------------------------------------------------------- F4 根因分析抽屉
const rootCauseVisible = ref(false)
const currentRootCauseAlert = ref<Alert | null>(null)
const rootCauseTask = useAsyncTask<RootCauseAnalysisResponse>()
const inFlightAlertId = ref<string | null>(null)
let currentRootCauseRunId = 0

function openRootCause(alert: Alert): void {
  const targetAlertId = String(alert.id)

  // 同对象重复提交保护：若正在对同一预警分析，忽略重复点击
  if (inFlightAlertId.value === targetAlertId && rootCauseTask.loading.value) {
    return
  }

  // P2 整改：切换预警或重开抽屉时立即取消进行中的任务并清空历史分析结果，避免串用
  rootCauseTask.cancel()
  rootCauseTask.reset()
  currentRootCauseAlert.value = alert
  rootCauseVisible.value = true
  inFlightAlertId.value = targetAlertId
  const runId = ++currentRootCauseRunId

  void (async () => {
    try {
      await rootCauseTask.run(async (signal) => {
        const res = await AlertsService.analyzeRootCause(targetAlertId, signal)
        // P2 整改：提前校验！在任务写入 data 前断言目标预警未被切换且为当前轮次
        if (runId !== currentRootCauseRunId || String(currentRootCauseAlert.value?.id) !== targetAlertId) {
          throw new DOMException('Alert switched', 'AbortError')
        }
        return res
      })
    } catch (err: unknown) {
      if (runId === currentRootCauseRunId && String(currentRootCauseAlert.value?.id) === targetAlertId) {
        showWriteError(err)
      }
    } finally {
      if (inFlightAlertId.value === targetAlertId) {
        inFlightAlertId.value = null
      }
    }
  })()
}

function handleCloseRootCause(): void {
  currentRootCauseRunId++
  inFlightAlertId.value = null
  rootCauseTask.cancel()
  rootCauseTask.reset()
  rootCauseVisible.value = false
  currentRootCauseAlert.value = null
}

function handleRootCauseDrawerClose(done: (cancel?: boolean) => void): void {
  handleCloseRootCause()
  done()
}

function getAnalysisStatusTag(status: string): { label: string; type: 'success' | 'warning' | 'info' | 'danger' } {
  switch (status) {
    case 'hypothesis':
      return { label: '因果假设', type: 'warning' }
    case 'insufficient_evidence':
      return { label: '证据不足', type: 'info' }
    case 'no_anomaly':
      return { label: '未见异常', type: 'success' }
    default:
      return { label: status || '未知', type: 'info' }
  }
}


// ---------------------------------------------------------------- 筛选表单
const filters = reactive({
  type: '',
  level: '',
  status: '',
  dateRange: null as [string, string] | null,
})

const typeOptions = ['全部', '质量异常', '延期风险', '设备停机']
const levelOptions = ['全部', '紧急', '重要', '一般']
const statusOptions = ['全部', '未处理', '已确认', '已关闭']

const page = ref(1)
const pageSize = ref(20)

// ---------------------------------------------------------------- 列表查询
const listTask = useAsyncTask<PageResult<Alert>>()

function fetchList(): void {
  void listTask.run((signal) => {
    const typeParam = filters.type && filters.type !== '全部' ? filters.type : undefined
    const levelParam = filters.level && filters.level !== '全部' ? filters.level : undefined
    const statusParam = filters.status && filters.status !== '全部' ? filters.status : undefined
    const startDateParam = filters.dateRange ? filters.dateRange[0] : undefined
    const endDateParam = filters.dateRange ? filters.dateRange[1] : undefined

    return AlertsService.list(
      {
        page: page.value,
        pageSize: pageSize.value,
        type: typeParam,
        level: levelParam,
        status: statusParam,
        startDate: startDateParam,
        endDate: endDateParam,
      },
      signal,
    )
  })
}

function handleSearch(): void {
  page.value = 1
  fetchList()
}

function handleReset(): void {
  filters.type = ''
  filters.level = ''
  filters.status = ''
  filters.dateRange = null
  page.value = 1
  fetchList()
}

function handlePageChange(newPage: number): void {
  page.value = newPage
  fetchList()
}

function handleSizeChange(newSize: number): void {
  pageSize.value = newSize
  page.value = 1
  fetchList()
}

// ---------------------------------------------------------------- 状态流转操作
const { submitting: transitionSubmitting, run: runTransition } = useSubmitGuard()

async function handleTransition(alert: Alert, targetStatus: string): Promise<void> {
  await runTransition(async () => {
    const actionText = targetStatus === '已确认' ? '确认' : '关闭'

    try {
      await ElMessageBox.confirm(
        `确定将预警 #${alert.id}（${alert.title}）的状态从【${alert.status}】流转为【${targetStatus}】吗？`,
        `预警${actionText}确认`,
        {
          confirmButtonText: '确定流转',
          cancelButtonText: '取消',
          type: targetStatus === '已关闭' ? 'success' : 'warning',
        },
      )
    } catch {
      return
    }

    const payload: AlertStateTransitionPayload = {
      expectedStatus: alert.status,
      targetStatus,
    }

    try {
      await AlertsService.transitionState(alert.id, payload)
      ElMessage.success(`预警 #${alert.id} 已成功流转为【${targetStatus}】`)
      if (currentDetailAlert.value && currentDetailAlert.value.id === alert.id) {
        currentDetailAlert.value.status = targetStatus
      }
      fetchList()
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- 详情抽屉
const detailVisible = ref(false)
const currentDetailAlert = ref<Alert | null>(null)

function openDetail(alert: Alert): void {
  currentDetailAlert.value = alert
  detailVisible.value = true
}

// ---------------------------------------------------------------- 辅助标签样式
function getLevelTagType(level: string): 'danger' | 'warning' | 'info' {
  if (level === '紧急') return 'danger'
  if (level === '重要') return 'warning'
  return 'info'
}

function getStatusTagType(status: string): 'danger' | 'warning' | 'success' | 'info' {
  if (status === '未处理') return 'danger'
  if (status === '已确认') return 'warning'
  if (status === '已关闭') return 'success'
  return 'info'
}

onMounted(() => {
  fetchList()
})
</script>

<template>
  <div class="alerts-page">
    <!-- 顶部标题 -->
    <div class="alerts-header">
      <div class="header-left">
        <div class="title-row">
          <el-icon class="title-icon"><Bell /></el-icon>
          <h2 class="title-text">B10 预警中心</h2>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
        <p class="subtitle-text">
          质量、交付与设备预警事件契约化集中归集、分级流转与闭环处理
        </p>
      </div>

      <div class="header-right">
        <el-button
          type="primary"
          plain
          :icon="Refresh"
          :loading="listTask.loading.value"
          @click="fetchList"
        >
          刷新预警
        </el-button>
      </div>
    </div>

    <!-- 边界说明通知 -->
    <div class="boundary-notice">
      <el-icon class="notice-icon"><InfoFilled /></el-icon>
      <div class="notice-text">
        <strong>契约与 Q6 决策边界：</strong>
        本页展示数据库中真实已持久化的预警记录，支持候选流转（未处理 → 已确认 → 已关闭）。
        预警自动持久化触发、去重键窗口及等级映射方案依赖 Q6 决策，未获批准前不启用后台自动写库。
      </div>
    </div>

    <!-- 筛选面板 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-row">
        <div class="filter-item">
          <span class="filter-label">预警类型:</span>
          <el-select v-model="filters.type" placeholder="全部类型" clearable style="width: 130px">
            <el-option v-for="t in typeOptions" :key="t" :label="t" :value="t" />
          </el-select>
        </div>

        <div class="filter-item">
          <span class="filter-label">等级:</span>
          <el-select v-model="filters.level" placeholder="全部等级" clearable style="width: 120px">
            <el-option v-for="l in levelOptions" :key="l" :label="l" :value="l" />
          </el-select>
        </div>

        <div class="filter-item">
          <span class="filter-label">处理状态:</span>
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 120px">
            <el-option v-for="s in statusOptions" :key="s" :label="s" :value="s" />
          </el-select>
        </div>

        <div class="filter-item">
          <span class="filter-label">创建日期:</span>
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width: 240px"
          />
        </div>

        <div class="filter-actions">
          <el-button type="primary" :icon="Search" @click="handleSearch">筛选</el-button>
          <el-button @click="handleReset">重置</el-button>
        </div>
      </div>
    </el-card>

    <!-- 列表数据呈现 -->
    <el-card class="table-card" shadow="never">
      <LoadingState v-if="listTask.loading.value && !listTask.data.value" text="正在加载预警列表..." />
      <ErrorState
        v-else-if="listTask.error.value"
        :error="listTask.error.value"
        @retry="fetchList"
      />

      <div v-else-if="listTask.data.value">
        <el-table
          :data="listTask.data.value.list"
          style="width: 100%"
          stripe
          border
          size="default"
        >
          <el-table-column prop="id" label="预警ID" width="100" align="center">
            <template #default="{ row }">
              <span class="id-text">#{{ row.id }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="level" label="等级" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="getLevelTagType(row.level)" size="small" effect="dark">
                {{ row.level }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="type" label="类型" width="120" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.type }}</el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="title" label="预警标题" min-width="180">
            <template #default="{ row }">
              <span class="alert-title font-bold">{{ row.title }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="content" label="详情描述" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="text-content">{{ row.content || '--' }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="status" label="处理状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="getStatusTagType(row.status)" size="small" effect="plain">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="createdAt" label="发现时间" width="190" align="center">
            <template #default="{ row }">
              <span class="time-text">{{ row.createdAt || '--' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="220" align="center" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button size="small" link type="primary" :icon="View" @click="openDetail(row)">
                  详情
                </el-button>

                <!-- F4 根因分析按钮（仅 admin 角色可用） -->
                <el-button
                  v-if="isAdmin"
                  size="small"
                  link
                  type="success"
                  @click="openRootCause(row)"
                >
                  根因分析
                </el-button>

                <!-- 候选流转按钮 -->
                <el-button
                  v-if="row.status === '未处理' && canTransition"
                  size="small"
                  type="warning"
                  plain
                  :disabled="transitionSubmitting"
                  @click="handleTransition(row, '已确认')"
                >
                  确认
                </el-button>

                <el-button
                  v-if="row.status === '已确认' && canTransition"
                  size="small"
                  type="success"
                  plain
                  :disabled="transitionSubmitting"
                  @click="handleTransition(row, '已关闭')"
                >
                  关闭
                </el-button>

                <span v-if="row.status === '已关闭'" class="closed-label">已终态</span>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页控件 -->
        <div class="pagination-row">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="listTask.data.value.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            @current-change="handlePageChange"
            @size-change="handleSizeChange"
          />
        </div>
      </div>

      <EmptyState v-else description="暂无预警记录" />
    </el-card>

    <!-- 预警详情抽屉 -->
    <el-drawer
      v-model="detailVisible"
      title="预警事件详情"
      size="480px"
      direction="rtl"
    >
      <div v-if="currentDetailAlert" class="drawer-detail-body">
        <div class="detail-header-card">
          <div class="detail-title-line">
            <el-tag :type="getLevelTagType(currentDetailAlert.level)" size="small" effect="dark">
              {{ currentDetailAlert.level }}
            </el-tag>
            <h3 class="detail-title">{{ currentDetailAlert.title }}</h3>
          </div>
          <div class="detail-status-badge">
            <el-tag :type="getStatusTagType(currentDetailAlert.status)" size="default" effect="plain">
              状态：{{ currentDetailAlert.status }}
            </el-tag>
            <DataSourceTag data-source="demo" data-label="演示数据" />
          </div>
        </div>

        <el-descriptions :column="1" border class="detail-desc-table">
          <el-descriptions-item label="预警 ID">
            <span class="id-text">#{{ currentDetailAlert.id }}</span>
          </el-descriptions-item>

          <el-descriptions-item label="预警类型">
            <el-tag size="small" effect="plain">{{ currentDetailAlert.type }}</el-tag>
          </el-descriptions-item>

          <el-descriptions-item label="预警详情">
            <div class="detail-content-box">{{ currentDetailAlert.content || '无详细描述' }}</div>
          </el-descriptions-item>

          <el-descriptions-item label="关联对象">
            <div v-if="currentDetailAlert.refType">
              {{ currentDetailAlert.refType }} : #{{ currentDetailAlert.refId }}
            </div>
            <div v-else class="text-gray">
              无结构化关联（依契约，设备/产线预警采用文字说明，refType/refId 为 null）
            </div>
          </el-descriptions-item>

          <el-descriptions-item label="创建时间">
            <span class="time-text">{{ currentDetailAlert.createdAt || '--' }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 详情页流转动作 -->
        <div v-if="canTransition" class="detail-actions-box">
          <h4 class="actions-title">状态处理流转（契约候选流转）</h4>
          <div class="actions-buttons">
            <el-button
              v-if="currentDetailAlert.status === '未处理'"
              type="warning"
              :disabled="transitionSubmitting"
              @click="handleTransition(currentDetailAlert, '已确认')"
            >
              确认为处理中（已确认）
            </el-button>

            <el-button
              v-if="currentDetailAlert.status === '已确认'"
              type="success"
              :disabled="transitionSubmitting"
              @click="handleTransition(currentDetailAlert, '已关闭')"
            >
              完成并关闭预警（已关闭）
            </el-button>

            <div v-if="currentDetailAlert.status === '已关闭'" class="closed-tip">
              该预警已处于关闭终态，无法再次流转。
            </div>
          </div>
        </div>

        <!-- 关联钻取快捷导航 -->
        <div class="drill-section">
          <h4 class="drill-title">关联业务钻取</h4>
          <div class="drill-links">
            <el-button
              v-if="isAdmin && currentDetailAlert"
              size="small"
              type="success"
              plain
              @click="openRootCause(currentDetailAlert)"
            >
              发起 AI 根因分析 (F4)
            </el-button>
            <el-button size="small" plain @click="() => router.push('/dashboard')">
              前往经营驾驶舱
            </el-button>
            <el-button size="small" plain @click="() => router.push('/work-orders')">
              查看生产工单
            </el-button>
            <el-button size="small" plain @click="() => router.push('/reports')">
              查看工序报工
            </el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- F4 根因分析抽屉 -->
    <el-drawer
      v-model="rootCauseVisible"
      title="预警根因分析（F4）"
      size="580px"
      :before-close="handleRootCauseDrawerClose"
    >
      <div v-if="currentRootCauseAlert" class="rc-drawer-content">
        <!-- 预警概要卡片 -->
        <el-card class="rc-alert-summary" shadow="never">
          <div class="rc-summary-header">
            <el-tag :type="getLevelTagType(currentRootCauseAlert.level)" size="small">
              {{ currentRootCauseAlert.level }}
            </el-tag>
            <el-tag size="small" effect="plain">{{ currentRootCauseAlert.type }}</el-tag>
            <span class="rc-summary-id">#{{ currentRootCauseAlert.id }}</span>
          </div>
          <div class="rc-summary-title">{{ currentRootCauseAlert.title }}</div>
          <div v-if="currentRootCauseAlert.content" class="rc-summary-desc">
            {{ currentRootCauseAlert.content }}
          </div>
        </el-card>

        <!-- 加载状态 -->
        <div v-if="rootCauseTask.loading.value" class="rc-state-box">
          <LoadingState message="正在受控分析关联设备、物料与质量证据..." />
        </div>

        <!-- 错误状态 -->
        <div v-else-if="rootCauseTask.error.value" class="rc-state-box">
          <ErrorState
            :error="rootCauseTask.error.value"
            title="根因分析失败"
            :retryable="true"
            @retry="currentRootCauseAlert && openRootCause(currentRootCauseAlert)"
          />
        </div>

        <!-- 根因分析结果 -->
        <div v-else-if="rootCauseTask.data.value" class="rc-result-content">
          <div class="rc-meta-bar">
            <div class="rc-meta-tags">
              <el-tag
                size="small"
                :type="getAnalysisStatusTag(rootCauseTask.data.value.analysisStatus).type"
                effect="dark"
              >
                {{ getAnalysisStatusTag(rootCauseTask.data.value.analysisStatus).label }}
              </el-tag>
              <AiModeTag :mode="rootCauseTask.data.value.mode as any" :degraded="rootCauseTask.data.value.degraded" />
              <DataSourceTag :data-source="rootCauseTask.data.value.dataSource" :data-label="rootCauseTask.data.value.dataLabel" />
            </div>
            <span class="rc-snapshot-time">快照：{{ rootCauseTask.data.value.snapshotAt }}</span>
          </div>

          <!-- 说明 -->
          <div v-if="rootCauseTask.data.value.explanation" class="rc-explanation-card">
            <el-icon><InfoFilled /></el-icon>
            <div class="rc-explanation-text">{{ rootCauseTask.data.value.explanation }}</div>
          </div>

          <!-- 可能原因列表 -->
          <div class="rc-section">
            <div class="rc-section-title">可能原因与关联依据</div>
            <div v-if="rootCauseTask.data.value.possibleCauses.length === 0" class="rc-empty-causes">
              <span>暂无推断原因（依据不足或未见关联异常，不编造假设）</span>
            </div>
            <div v-else class="rc-causes-list">
              <div
                v-for="(cause, idx) in rootCauseTask.data.value.possibleCauses"
                :key="idx"
                class="rc-cause-card"
              >
                <div class="rc-cause-text">{{ cause.text }}</div>
                <div v-if="cause.evidenceRefs && cause.evidenceRefs.length > 0" class="rc-refs-row">
                  <span class="rc-refs-label">证据引用：</span>
                  <el-tag
                    v-for="ref in cause.evidenceRefs"
                    :key="ref"
                    size="small"
                    type="info"
                  >
                    {{ ref }}
                  </el-tag>
                </div>
              </div>
            </div>
          </div>

          <!-- 建议 -->
          <div v-if="rootCauseTask.data.value.suggestion" class="rc-section">
            <div class="rc-section-title">处置建议</div>
            <div class="rc-suggestion-box">
              <div class="rc-suggestion-text">{{ rootCauseTask.data.value.suggestion }}</div>
              <div class="rc-suggestion-disclaimer">
                * 建议仅供人工决策参考，系统不执行自动调线、改单或关闭预警。
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.alerts-page {
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.alerts-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-icon {
  font-size: 24px;
  color: #ea580c;
}

.title-text {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #1e293b;
}

.subtitle-text {
  margin: 4px 0 0;
  font-size: 13px;
  color: #64748b;
}

.header-right {
  display: flex;
  align-items: center;
}

/* 边界说明条 */
.boundary-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #3b82f6;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  color: #334155;
}

.notice-icon {
  font-size: 18px;
  color: #3b82f6;
}

/* 筛选卡片 */
.filter-card {
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 13px;
  color: #475569;
  font-weight: 500;
  white-space: nowrap;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* 表格卡片 */
.table-card {
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.id-text {
  font-family: monospace;
  font-weight: 600;
  color: #475569;
}

.font-bold {
  font-weight: 600;
}

.text-content {
  color: #334155;
  font-size: 13px;
}

.time-text {
  font-family: monospace;
  font-size: 12px;
  color: #64748b;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.closed-label {
  font-size: 12px;
  color: #94a3b8;
}

.pagination-row {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

/* 抽屉样式 */
.drawer-detail-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-header-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
}

.detail-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.detail-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
}

.detail-status-badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-desc-table {
  margin-top: 8px;
}

.detail-content-box {
  background: #ffffff;
  padding: 8px;
  border-radius: 4px;
  line-height: 1.5;
  color: #334155;
}

.text-gray {
  color: #94a3b8;
  font-size: 12px;
}

.detail-actions-box {
  background: #fffbeb;
  border: 1px solid #fef3c7;
  border-radius: 8px;
  padding: 14px;
}

.actions-title {
  margin: 0 0 10px;
  font-size: 14px;
  color: #92400e;
}

.actions-buttons {
  display: flex;
  gap: 10px;
}

.closed-tip {
  font-size: 13px;
  color: #15803d;
}

.drill-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 14px;
}

.drill-title {
  margin: 0 0 10px;
  font-size: 13px;
  color: #64748b;
}

.drill-links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* F4 根因分析抽屉 */
.rc-drawer-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rc-alert-summary {
  background: #f8fafc;
  border-radius: 6px;
}

.rc-summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.rc-summary-id {
  font-family: monospace;
  font-size: 12px;
  color: #64748b;
  margin-left: auto;
}

.rc-summary-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 4px;
}

.rc-summary-desc {
  font-size: 13px;
  color: #475569;
  line-height: 1.5;
}

.rc-state-box {
  padding: 30px 0;
}

.rc-result-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rc-meta-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  background: #f1f5f9;
  padding: 8px 12px;
  border-radius: 6px;
}

.rc-meta-tags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rc-snapshot-time {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}

.rc-explanation-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: #fffbeb;
  border: 1px solid #fef3c7;
  border-radius: 6px;
  padding: 10px 12px;
  color: #92400e;
  font-size: 13px;
  line-height: 1.5;
}

.rc-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rc-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.rc-empty-causes {
  font-size: 13px;
  color: #94a3b8;
  padding: 12px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px dashed #cbd5e1;
}

.rc-causes-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rc-cause-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
}

.rc-cause-text {
  font-size: 13px;
  color: #1e293b;
  line-height: 1.5;
  margin-bottom: 6px;
}

.rc-refs-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.rc-refs-label {
  font-size: 11px;
  color: #64748b;
}

.rc-suggestion-box {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-left: 4px solid #22c55e;
  border-radius: 6px;
  padding: 12px;
}

.rc-suggestion-text {
  font-size: 13px;
  color: #15803d;
  font-weight: 500;
  line-height: 1.5;
  margin-bottom: 6px;
}

.rc-suggestion-disclaimer {
  font-size: 11px;
  color: #16a34a;
}
</style>
