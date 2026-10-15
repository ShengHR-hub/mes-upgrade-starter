<script setup lang="ts">
/**
 * B8 经营驾驶舱页面 —— 契约 §6.8。
 *
 * 核心指标口径：
 * 1. 产量和良品率：只统计末道工序有效报工，outputQty = goodQty + badQty，goodRate = goodQty / outputQty * 100；
 *    跨产线加权合计（先加数量再算比率）；界面注明“报工良品率（非真实FPY）”。
 * 2. 每日计划：工单 planStart～planEnd 的 DATE 区间，前 N-1 天 floor(qty/N)，最后一天补差；
 * 3. 累计完成率：completionRate = doneQty / planTotalQty * 100（doneQty 截至当前截止时刻的末道累计良品）；
 * 4. 设备指标：真实状态计数，OEE 显示 null 及 missingInputs 缺失项说明；
 * 5. 交付统计：按 dueDate 筛选订单，按 Q1 规则派生当前完成/延期状态。
 *
 * 防护机制：
 * - useAsyncTask 隔离轮次与取消迟到响应；
 * - 钻取跳转携带真实参数；
 * - 纯规则评估展示触发状态，与预警中心口径一致，未获 Q6 批准前不暗中写库。
 */
import {
  DataAnalysis,
  Filter,
  Monitor,
  Odometer,
  Refresh,
  Search,
  WarningFilled,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import {
  DashboardsService,
  type DashboardDeliveryMetricsResponse,
  type DashboardDeviceMetricsResponse,
  type DashboardProductionMetricsResponse,
  type DashboardQualityMetricsResponse,
} from '@/services/dashboards'
import {
  formatCalculationStatus,
  formatCount,
  formatPercent,
} from '@/utils/format'

const router = useRouter()

// ---------------------------------------------------------------- 日期辅助
function getTodayString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getPastDateString(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------- 筛选表单
const today = getTodayString()
const dateRange = ref<[string, string]>([today, today])

const filters = reactive({
  workshop: '',
  prodLine: '',
  productCode: '',
})

const workshopOptions = ['全部', '一车间', '二车间', '三车间', '未分配']
const prodLineOptions = ['全部', 'SMT-1线', 'SMT-2线', 'SMT-3线', 'ASSY-1线', 'ASSY-2线', 'CAL-1线', 'CAL-2线', '未分配']
const productOptions = [
  '全部',
  'JC-PLC-2001',
  'JC-PLC-2002',
  'JC-PLC-2003',
  'JC-DRV-1001',
  'JC-IoT-4G-A',
  'JC-IoT-4G-B',
  'JC-IoT-5G-A',
  'JC-IoT-NB-A',
  'JC-SEN-T100',
  'JC-SEN-T200',
  'JC-SEN-P100',
  'JC-SEN-P200',
  'JC-SEN-H100',
  'JC-SEN-V100',
  'JC-SEN-C100',
]

// ---------------------------------------------------------------- 异步任务与数据
interface DashboardData {
  production: DashboardProductionMetricsResponse
  quality: DashboardQualityMetricsResponse
  device: DashboardDeviceMetricsResponse
  delivery: DashboardDeliveryMetricsResponse
}

const dashboardTask = useAsyncTask<DashboardData>()
const data = computed(() => dashboardTask.data.value)

function loadDashboard(): void {
  const [startDate, endDate] = dateRange.value ?? [today, today]

  void dashboardTask.run(async (signal) => {
    const prodLineParam = filters.prodLine && filters.prodLine !== '全部' ? filters.prodLine : undefined
    const workshopParam = filters.workshop && filters.workshop !== '全部' ? filters.workshop : undefined
    const productCodeParam = filters.productCode && filters.productCode !== '全部' ? filters.productCode : undefined

    const [production, quality, device, delivery] = await Promise.all([
      DashboardsService.getProductionMetrics(
        {
          startDate,
          endDate,
          prodLine: prodLineParam,
          workshop: workshopParam,
          productCode: productCodeParam,
        },
        signal,
      ),
      DashboardsService.getQualityMetrics(
        {
          startDate,
          endDate,
          prodLine: prodLineParam,
          workshop: workshopParam,
          productCode: productCodeParam,
        },
        signal,
      ),
      DashboardsService.getDeviceMetrics(
        {
          workshop: workshopParam,
          prodLine: prodLineParam,
        },
        signal,
      ),
      DashboardsService.getDeliveryMetrics(
        {
          startDate,
          endDate,
          productCode: productCodeParam,
        },
        signal,
      ),
    ])

    return { production, quality, device, delivery }
  })
}

function handlePreset(days: number): void {
  const end = getTodayString()
  const start = days === 1 ? end : getPastDateString(days - 1)
  dateRange.value = [start, end]
  loadDashboard()
}

function handleSearch(): void {
  if (!dateRange.value || dateRange.value.length < 2) {
    ElMessage.warning('请选择查询日期范围')
    return
  }
  loadDashboard()
}

function handleReset(): void {
  dateRange.value = [today, today]
  filters.workshop = ''
  filters.prodLine = ''
  filters.productCode = ''
  loadDashboard()
}

// ---------------------------------------------------------------- 规则评估衍生状态
const ruleGoodRateTriggered = computed(() => {
  const q = data.value?.quality
  if (!q) return false
  const output = (q.goodQty ?? 0) + (q.badQty ?? 0)
  if (output > 0) return (q.goodQty * 100) < (97 * output)
  return q.goodRate !== null && q.goodRate !== undefined && q.goodRate < 97
})

const ruleCompRateTriggered = computed(() => {
  const p = data.value?.production
  if (!p) return false
  if (p.metrics.calculationStatus === 'insufficient_data') return false
  const planTotal = p.metrics.planTotalQty ?? 0
  if (planTotal > 0) return (p.metrics.doneQty * 100) < (90 * planTotal)
  return p.metrics.completionRate !== null && p.metrics.completionRate !== undefined && p.metrics.completionRate < 90
})

const ruleDeviceTriggered = computed(() => {
  const cnt = data.value?.device.counts['维修中'] ?? 0
  return cnt > 0
})

const activeAlertRulesCount = computed(() => {
  let count = 0
  if (ruleGoodRateTriggered.value) count++
  if (ruleCompRateTriggered.value) count++
  if (ruleDeviceTriggered.value) count++
  return count
})

// ---------------------------------------------------------------- 钻取导航
function drillToWorkOrders(prodLine?: string): void {
  const query: Record<string, string> = {}
  if (filters.productCode && filters.productCode !== '全部') {
    query.productCode = filters.productCode
  }
  const line = prodLine || (filters.prodLine && filters.prodLine !== '全部' ? filters.prodLine : undefined)
  if (line && line !== '全部') {
    query.prodLine = line
  }
  if (filters.workshop && filters.workshop !== '全部') {
    query.workshop = filters.workshop
  }
  void router.push({ path: '/work-orders', query })
}

function drillToReports(prodLine?: string): void {
  const query: Record<string, string> = {}
  if (dateRange.value) {
    query.startDate = dateRange.value[0]
    query.endDate = dateRange.value[1]
  }
  const line = prodLine || (filters.prodLine && filters.prodLine !== '全部' ? filters.prodLine : undefined)
  if (line && line !== '全部') {
    query.prodLine = line
  }
  if (filters.workshop && filters.workshop !== '全部') {
    query.workshop = filters.workshop
  }
  if (filters.productCode && filters.productCode !== '全部') {
    query.productCode = filters.productCode
  }
  void router.push({ path: '/reports', query })
}

function drillToQualityInspections(): void {
  const query: Record<string, string> = {}
  if (dateRange.value) {
    query.startDate = dateRange.value[0]
    query.endDate = dateRange.value[1]
  }
  if (filters.prodLine && filters.prodLine !== '全部') {
    query.prodLine = filters.prodLine
  }
  if (filters.workshop && filters.workshop !== '全部') {
    query.workshop = filters.workshop
  }
  if (filters.productCode && filters.productCode !== '全部') {
    query.productCode = filters.productCode
  }
  void router.push({ path: '/quality-inspections', query })
}

function drillToOrders(): void {
  const query: Record<string, string> = {}
  if (dateRange.value) {
    query.dueDateFrom = dateRange.value[0]
    query.dueDateTo = dateRange.value[1]
  }
  if (filters.productCode && filters.productCode !== '全部') {
    query.productCode = filters.productCode
  }
  void router.push({ path: '/orders', query })
}

function drillToAlerts(): void {
  void router.push('/alerts')
}

onMounted(() => {
  loadDashboard()
})
</script>

<template>
  <div class="dashboard-page">
    <!-- 顶栏标题与标识 -->
    <div class="dashboard-header">
      <div class="header-left">
        <div class="title-row">
          <el-icon class="title-icon"><Odometer /></el-icon>
          <h2 class="title-text">B8 经营驾驶舱</h2>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
        <p class="subtitle-text">
          生产进度、报工良品率、设备状态与交付统计权威看板（数据与工序报工同源聚合）
        </p>
      </div>

      <div class="header-right">
        <div v-if="data" class="snapshot-badge">
          <span class="snapshot-label">数据截止快照</span>
          <span class="snapshot-time">{{ data.production.snapshotAt }}</span>
        </div>
        <el-button
          type="primary"
          plain
          :icon="Refresh"
          :loading="dashboardTask.loading.value"
          @click="loadDashboard"
        >
          手动刷新
        </el-button>
      </div>
    </div>

    <!-- 筛选面板 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-row">
        <div class="filter-item date-item">
          <span class="filter-label">查询周期:</span>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            :clearable="false"
            style="width: 250px"
          />
          <div class="preset-buttons">
            <el-button size="small" text @click="handlePreset(1)">今日</el-button>
            <el-button size="small" text @click="handlePreset(3)">近3天</el-button>
            <el-button size="small" text @click="handlePreset(7)">近7天</el-button>
          </div>
        </div>

        <div class="filter-item">
          <span class="filter-label">车间:</span>
          <el-select v-model="filters.workshop" placeholder="车间筛选" clearable style="width: 130px">
            <el-option v-for="w in workshopOptions" :key="w" :label="w" :value="w" />
          </el-select>
        </div>

        <div class="filter-item">
          <span class="filter-label">产线:</span>
          <el-select v-model="filters.prodLine" placeholder="产线筛选" clearable style="width: 130px">
            <el-option v-for="l in prodLineOptions" :key="l" :label="l" :value="l" />
          </el-select>
        </div>

        <div class="filter-item">
          <span class="filter-label">产品:</span>
          <el-select v-model="filters.productCode" placeholder="产品筛选" clearable style="width: 150px">
            <el-option v-for="p in productOptions" :key="p" :label="p" :value="p" />
          </el-select>
        </div>

        <div class="filter-actions">
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </div>
      </div>
    </el-card>

    <!-- 加载与错误状态 -->
    <LoadingState v-if="dashboardTask.loading.value && !data" text="正在聚合驾驶舱指标..." />
    <ErrorState
      v-else-if="dashboardTask.error.value"
      :error="dashboardTask.error.value"
      @retry="loadDashboard"
    />

    <!-- 数据呈现区 -->
    <div v-else-if="data" class="dashboard-content">
      <!-- 预警规则速览条（纯评估状态，区分持久化） -->
      <div v-if="activeAlertRulesCount > 0" class="rule-alert-banner">
        <div class="alert-banner-left">
          <el-icon class="alert-icon"><WarningFilled /></el-icon>
          <div class="alert-banner-text">
            <strong>内部规则评估提示：</strong>
            <span>当前筛选条件下触发 {{ activeAlertRulesCount }} 项预警条件：</span>
            <el-tag v-if="ruleGoodRateTriggered" type="danger" size="small" effect="plain" class="rule-chip">
              报工良品率 &lt; 97%（当前 {{ formatPercent(data.quality.goodRate) }}）
            </el-tag>
            <el-tag v-if="ruleCompRateTriggered" type="warning" size="small" effect="plain" class="rule-chip">
              累计完成率 &lt; 90%（当前 {{ formatPercent(data.production.metrics.completionRate) }}）
            </el-tag>
            <el-tag v-if="ruleDeviceTriggered" type="danger" size="small" effect="plain" class="rule-chip">
              维修中设备 {{ data.device.counts['维修中'] }} 台
            </el-tag>
          </div>
        </div>
        <div class="alert-banner-right">
          <span class="rule-eval-note">（只读内存评估，未获 Q6 批准不自动写库）</span>
          <el-button size="small" type="warning" plain @click="drillToAlerts">
            前往预警中心
          </el-button>
        </div>
      </div>

      <!-- 四大核心指标卡片 -->
      <div class="metrics-grid">
        <!-- 卡片 1：生产进度与计划 -->
        <el-card class="metric-card prod-card" shadow="hover">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-tag prod-tag">生产执行</span>
              <h3 class="card-title">生产计划与完成率</h3>
            </div>
            <el-tooltip content="工单计划区间分摊算法；累计完成率 = 累计良品 / 入选工单总计划数" placement="top">
              <el-icon class="info-icon"><DataAnalysis /></el-icon>
            </el-tooltip>
          </div>

          <div class="kpi-block">
            <div class="kpi-main">
              <span class="kpi-label">累计完成率</span>
              <div class="kpi-number-row">
                <span class="kpi-value text-indigo">
                  {{ formatPercent(data.production.metrics.completionRate) }}
                </span>
                <el-tag
                  v-if="ruleCompRateTriggered"
                  type="warning"
                  size="small"
                  effect="dark"
                  class="warning-tag"
                >
                  &lt;90%预警
                </el-tag>
              </div>
            </div>
            <el-progress
              :percentage="Math.min(100, Math.max(0, data.production.metrics.completionRate ?? 0))"
              :status="ruleCompRateTriggered ? 'warning' : 'success'"
              :stroke-width="8"
              :show-text="false"
            />
          </div>

          <div class="sub-metrics-grid">
            <div class="sub-metric-item">
              <span class="sub-label">窗口分摊计划</span>
              <span class="sub-value">{{ formatCount(data.production.metrics.planQty) }}</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">入选计划总数</span>
              <span class="sub-value">{{ formatCount(data.production.metrics.planTotalQty) }}</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">累计完工良品</span>
              <span class="sub-value text-indigo">{{ formatCount(data.production.metrics.doneQty) }}</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">窗口报工产量</span>
              <span class="sub-value">{{ formatCount(data.production.metrics.outputQty) }}</span>
            </div>
          </div>

          <div class="card-footer-actions">
            <el-button size="small" text type="primary" @click="() => drillToWorkOrders()">
              钻取工单 &gt;
            </el-button>
            <el-button size="small" text type="primary" @click="() => drillToReports()">
              钻取报工 &gt;
            </el-button>
          </div>
        </el-card>

        <!-- 卡片 2：质量与报工良品率 -->
        <el-card class="metric-card quality-card" shadow="hover">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-tag quality-tag">质量控制</span>
              <h3 class="card-title">报工良品率</h3>
            </div>
            <el-tooltip content="仅统计末道工序有效报工；跨产线先合计数量再算比率，不等同于真实 FPY" placement="top">
              <el-icon class="info-icon"><DataAnalysis /></el-icon>
            </el-tooltip>
          </div>

          <div class="kpi-block">
            <div class="kpi-main">
              <span class="kpi-label">报工良品率 (非真实FPY)</span>
              <div class="kpi-number-row">
                <span class="kpi-value" :class="ruleGoodRateTriggered ? 'text-danger' : 'text-emerald'">
                  {{ formatPercent(data.quality.goodRate) }}
                </span>
                <el-tag
                  v-if="ruleGoodRateTriggered"
                  type="danger"
                  size="small"
                  effect="dark"
                  class="warning-tag"
                >
                  &lt;97%预警
                </el-tag>
                <el-tag v-else-if="data.quality.goodRate !== null" type="success" size="small" effect="plain">
                  达标
                </el-tag>
              </div>
            </div>
            <el-progress
              :percentage="Math.min(100, Math.max(0, data.quality.goodRate ?? 0))"
              :status="ruleGoodRateTriggered ? 'exception' : 'success'"
              :stroke-width="8"
              :show-text="false"
            />
          </div>

          <div class="sub-metrics-grid">
            <div class="sub-metric-item">
              <span class="sub-label">窗口良品数</span>
              <span class="sub-value text-emerald">{{ formatCount(data.quality.goodQty) }}</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">窗口不良数</span>
              <span class="sub-value text-danger">{{ formatCount(data.quality.badQty) }}</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">末道有效产量</span>
              <span class="sub-value">{{ formatCount(data.quality.goodQty + data.quality.badQty) }}</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">FPY判定</span>
              <span class="sub-value tag-fpy">非真实FPY</span>
            </div>
          </div>

          <div class="card-footer-actions">
            <el-button size="small" text type="primary" @click="drillToQualityInspections">
              钻取质量检验 &gt;
            </el-button>
            <el-button size="small" text type="primary" @click="() => drillToReports()">
              查看报工记录 &gt;
            </el-button>
          </div>
        </el-card>

        <!-- 卡片 3：设备运行状态 -->
        <el-card class="metric-card device-card" shadow="hover">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-tag device-tag">设备状态</span>
              <h3 class="card-title">设备分布与 OEE</h3>
            </div>
            <el-tooltip content="设备状态计数来自实时主数据；OEE 依据 Q3 决策返回缺失项说明" placement="top">
              <el-icon class="info-icon"><Monitor /></el-icon>
            </el-tooltip>
          </div>

          <div class="device-status-counts">
            <div class="status-count-item bg-green-light">
              <span class="status-name text-green">运行中</span>
              <span class="status-num text-green">{{ data.device.counts['运行中'] }}</span>
            </div>
            <div class="status-count-item bg-blue-light">
              <span class="status-name text-blue">待机</span>
              <span class="status-num text-blue">{{ data.device.counts['待机'] }}</span>
            </div>
            <div class="status-count-item bg-red-light">
              <span class="status-name text-red">维修中</span>
              <span class="status-num text-red">{{ data.device.counts['维修中'] }}</span>
            </div>
            <div class="status-count-item bg-gray-light">
              <span class="status-name text-gray">停机</span>
              <span class="status-num text-gray">{{ data.device.counts['停机'] }}</span>
            </div>
          </div>

          <div class="oee-missing-section">
            <div class="oee-header">
              <span class="oee-label">综合设备效率 (OEE)</span>
              <el-tag type="info" size="small">缺失项展示 (Q3验收决策)</el-tag>
            </div>
            <div class="oee-status-row">
              <span class="oee-val">--</span>
              <span class="oee-status-tag">{{ formatCalculationStatus(data.device.calculationStatus) }}</span>
            </div>
            <div class="missing-inputs-list">
              <span class="missing-tip">缺失输入项：</span>
              <el-tag
                v-for="input in data.device.missingInputs"
                :key="input"
                size="small"
                type="danger"
                effect="plain"
                class="missing-chip"
              >
                {{ input }}
              </el-tag>
            </div>
          </div>

          <div class="card-footer-actions">
            <el-button size="small" text type="primary" @click="() => router.push('/devices')">
              查看设备管理 &gt;
            </el-button>
          </div>
        </el-card>

        <!-- 卡片 4：订单交付统计 -->
        <el-card class="metric-card delivery-card" shadow="hover">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-tag delivery-tag">履约交付</span>
              <h3 class="card-title">订单交付履约</h3>
            </div>
            <el-tooltip content="按交期 dueDate 筛选订单；依据 Q1 权威规则判定已完成/已延期/生产中" placement="top">
              <el-icon class="info-icon"><DataAnalysis /></el-icon>
            </el-tooltip>
          </div>

          <div class="kpi-block">
            <div class="kpi-main">
              <span class="kpi-label">交付订单总数 (按交期筛选)</span>
              <div class="kpi-number-row">
                <span class="kpi-value text-purple">{{ data.delivery.orderCount }}</span>
                <span class="kpi-unit">单</span>
              </div>
            </div>
          </div>

          <div class="sub-metrics-grid">
            <div class="sub-metric-item">
              <span class="sub-label">已完成订单</span>
              <span class="sub-value text-emerald">{{ data.delivery.completedOrderCount }} 单</span>
            </div>
            <div class="sub-metric-item">
              <span class="sub-label">已延期订单</span>
              <span class="sub-value" :class="data.delivery.delayedOrderCount > 0 ? 'text-danger' : ''">
                {{ data.delivery.delayedOrderCount }} 单
              </span>
            </div>
            <div class="sub-metric-item full-width">
              <span class="sub-label">判定原则</span>
              <span class="sub-note">已完成 &gt; 已延期 &gt; 生产中（全工单完工才算完成）</span>
            </div>
          </div>

          <div class="card-footer-actions">
            <el-button size="small" text type="primary" @click="drillToOrders">
              钻取销售订单 &gt;
            </el-button>
          </div>
        </el-card>
      </div>

      <!-- 产线对比分析表格 -->
      <el-card class="table-card" shadow="never">
        <template #header>
          <div class="table-card-header">
            <div class="table-title-group">
              <el-icon><Filter /></el-icon>
              <h3 class="table-title">产线明细与对比分析</h3>
              <span class="table-subtitle">（跨产线先加数量再算比率，避免比率算术平均误差）</span>
            </div>
            <span class="lines-count-tag">共 {{ data.production.lines.length }} 条产线</span>
          </div>
        </template>

        <el-table
          :data="data.production.lines"
          style="width: 100%"
          stripe
          border
          size="default"
        >
          <el-table-column prop="prodLine" label="产线名称" min-width="120" fixed="left">
            <template #default="{ row }">
              <span class="line-name font-bold">{{ row.prodLine }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="planQty" label="窗口分摊计划" min-width="120" align="right">
            <template #default="{ row }">{{ formatCount(row.planQty) }}</template>
          </el-table-column>

          <el-table-column prop="planTotalQty" label="工单计划总数" min-width="120" align="right">
            <template #default="{ row }">{{ formatCount(row.planTotalQty) }}</template>
          </el-table-column>

          <el-table-column prop="doneQty" label="累计完工良品" min-width="120" align="right">
            <template #default="{ row }">
              <span class="text-indigo font-bold">{{ formatCount(row.doneQty) }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="outputQty" label="窗口报工产量" min-width="120" align="right">
            <template #default="{ row }">{{ formatCount(row.outputQty) }}</template>
          </el-table-column>

          <el-table-column prop="goodQty" label="报工良品数" min-width="110" align="right">
            <template #default="{ row }">
              <span class="text-emerald">{{ formatCount(row.goodQty) }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="badQty" label="报工不良数" min-width="110" align="right">
            <template #default="{ row }">
              <span :class="row.badQty > 0 ? 'text-danger' : ''">{{ formatCount(row.badQty) }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="completionRate" label="累计完成率" min-width="130" align="center">
            <template #default="{ row }">
              <el-tag
                :type="row.completionRate !== null && row.completionRate < 90 ? 'warning' : 'success'"
                size="small"
                effect="plain"
              >
                {{ formatPercent(row.completionRate) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="goodRate" label="报工良品率" min-width="130" align="center">
            <template #default="{ row }">
              <el-tag
                :type="row.goodRate !== null && row.goodRate < 97 ? 'danger' : 'success'"
                size="small"
                effect="plain"
              >
                {{ formatPercent(row.goodRate) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="操作" min-width="140" align="center" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="() => drillToReports(row.prodLine)">
                报工钻取
              </el-button>
              <el-button size="small" link type="primary" @click="() => drillToWorkOrders(row.prodLine)">
                工单钻取
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <EmptyState v-else description="暂无符合条件的驾驶舱数据" />
  </div>
</template>

<style scoped>
.dashboard-page {
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 顶部标题栏 */
.dashboard-header {
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
  color: #4f46e5;
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
  gap: 12px;
}

.snapshot-badge {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 10px;
}

.snapshot-label {
  font-size: 11px;
  color: #94a3b8;
}

.snapshot-time {
  font-size: 12px;
  font-family: monospace;
  font-weight: 600;
  color: #334155;
}

/* 筛选区域 */
.filter-card {
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
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

.date-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-buttons {
  display: flex;
  gap: 2px;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* 规则预警横幅 */
.rule-alert-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 10px 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.alert-banner-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.alert-icon {
  font-size: 20px;
  color: #d97706;
}

.alert-banner-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #92400e;
  flex-wrap: wrap;
}

.rule-chip {
  font-weight: 500;
}

.alert-banner-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rule-eval-note {
  font-size: 12px;
  color: #b45309;
}

/* 四大指标卡片网格 */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.metric-card {
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  display: flex;
  flex-direction: column;
}

.metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.prod-tag {
  background: #ede9fe;
  color: #6366f1;
}

.quality-tag {
  background: #ccfbf1;
  color: #0f766e;
}

.device-tag {
  background: #fef3c7;
  color: #b45309;
}

.delivery-tag {
  background: #f3e8ff;
  color: #9333ea;
}

.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.info-icon {
  font-size: 16px;
  color: #94a3b8;
  cursor: pointer;
}

.kpi-block {
  margin-bottom: 16px;
}

.kpi-main {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}

.kpi-label {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 2px;
}

.kpi-number-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.kpi-value {
  font-size: 30px;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.1;
}

.kpi-unit {
  font-size: 14px;
  color: #64748b;
}

.text-indigo { color: #4f46e5; }
.text-emerald { color: #059669; }
.text-danger { color: #dc2626; }
.text-purple { color: #9333ea; }
.text-green { color: #16a34a; }
.text-blue { color: #2563eb; }
.text-red { color: #dc2626; }
.text-gray { color: #64748b; }

.sub-metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 12px;
}

.sub-metric-item {
  display: flex;
  flex-direction: column;
}

.sub-metric-item.full-width {
  grid-column: 1 / -1;
}

.sub-label {
  font-size: 11px;
  color: #64748b;
}

.sub-value {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.sub-note {
  font-size: 11px;
  color: #94a3b8;
}

.tag-fpy {
  font-size: 12px;
  color: #0891b2;
  font-weight: 500;
}

.card-footer-actions {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid #f1f5f9;
  padding-top: 8px;
}

/* 设备状态块 */
.device-status-counts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 12px;
}

.status-count-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  border-radius: 6px;
}

.bg-green-light { background: #f0fdf4; border: 1px solid #dcfce7; }
.bg-blue-light { background: #eff6ff; border: 1px solid #dbeafe; }
.bg-red-light { background: #fef2f2; border: 1px solid #fee2e2; }
.bg-gray-light { background: #f8fafc; border: 1px solid #f1f5f9; }

.status-name { font-size: 11px; font-weight: 500; }
.status-num { font-size: 16px; font-weight: 700; margin-top: 2px; }

.oee-missing-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
}

.oee-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.oee-label {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.oee-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.oee-val {
  font-size: 20px;
  font-weight: 700;
  color: #94a3b8;
}

.oee-status-tag {
  font-size: 12px;
  color: #d97706;
  font-weight: 500;
}

.missing-inputs-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.missing-tip {
  font-size: 11px;
  color: #64748b;
}

.missing-chip {
  font-size: 11px;
}

/* 产线表格卡片 */
.table-card {
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.table-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.table-subtitle {
  font-size: 12px;
  color: #64748b;
}

.lines-count-tag {
  font-size: 12px;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
}

.font-bold {
  font-weight: 600;
}
</style>
