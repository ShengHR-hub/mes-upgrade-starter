<script setup lang="ts">
/**
 * B11 SPC 质量分析页面 —— 契约 §6.5。
 *
 * 口径与边界（任务书 §B11）：
 * 1. Pareto 使用 defect.qty，按 qty 降序、defectType 升序，含 share / cumulativeShare；
 * 2. 趋势使用**报工数量**（report.good_qty / bad_qty），不把质检 ng_qty 重复计入；
 * 3. 良品率恒标注 isTrueFpy:false（报工良品率 ≠ 真实 FPY），页面明示；
 * 4. 产线过滤只纳入可确认归属的记录；无任务关联记录显示「未分配」口径由服务端处理；
 * 5. 空数据 / 无缺陷 / 无报工 → 诚实展示「无数据」，不以 0 冒充未知；
 * 6. 日期为严格半开区间（Asia/Shanghai），沿用服务端口径。
 */
import { Refresh, Search } from '@element-plus/icons-vue'
import { computed, reactive } from 'vue'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { qualityAnalysesService } from '@/services/quality-analyses'
import { formatPercent } from '@/utils/format'
import { buildSpcQueries } from '@/utils/spc-query'
import { buildParetoChartData, buildTrendChartData } from '@/utils/spc-charts'

import type { GoodRateResponse, ParetoResponse, TrendResponse } from '@/types/quality-analysis'

const paretoTask = useAsyncTask<ParetoResponse>()
const trendTask = useAsyncTask<TrendResponse>()
const goodRateTask = useAsyncTask<GoodRateResponse>()

const prodLineOptions = [
  '全部',
  'SMT-1线',
  'SMT-2线',
  'SMT-3线',
  'ASSY-1线',
  'ASSY-2线',
  'CAL-1线',
  'CAL-2线',
  '未分配',
]

const filters = reactive({
  startDate: '',
  endDate: '',
  prodLine: '全部',
  stepName: '',
})

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
function past(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

filters.startDate = past(6)
filters.endDate = today()

/**
 * 各接口**分别**构造允许的参数（S11 复审 P2 修复，逻辑收敛到 `utils/spc-query.ts`）：
 * `stepName` 只允许用于趋势接口（契约 §6.5），Pareto 与良品率不得携带，
 * 否则服务端 forbidNonWhitelisted 会以 400/10001 拒绝整组查询。
 */
function fetchAll(): void {
  const queries = buildSpcQueries({
    startDate: filters.startDate,
    endDate: filters.endDate,
    prodLine: filters.prodLine,
    stepName: filters.stepName,
  })
  void paretoTask.run((signal) => qualityAnalysesService.paretos(queries.pareto, signal))
  void trendTask.run((signal) => qualityAnalysesService.trends(queries.trend, signal))
  void goodRateTask.run((signal) => qualityAnalysesService.goodRates(queries.goodRate, signal))
}

// 页面加载即查询一次
fetchAll()

const paretoChart = computed(() => buildParetoChartData(paretoTask.data.value?.items ?? []))
const trendChart = computed(() => buildTrendChartData(trendTask.data.value?.points ?? []))

const paretoNoData = computed(() => paretoTask.data.value?.calculationStatus === 'no_data')
const trendNoData = computed(() => trendTask.data.value?.calculationStatus === 'no_data')
const goodRateNoData = computed(() => goodRateTask.data.value?.calculationStatus === 'no_data')

const snapshotText = computed(() => {
  const snapshot = paretoTask.data.value?.snapshotAt ?? goodRateTask.data.value?.snapshotAt
  return snapshot ? `数据截至 ${snapshot}` : ''
})

// 明确的能力说明（契约 §6.5：不得把报工良品率冒充真实 FPY）
const SPC_LIMITATIONS: readonly string[] = [
  'Pareto 仅按已记录的不良明细（defect.qty）统计，同件多缺陷体系另行确认，不做推断。',
  '趋势与良品率使用报工数量（report.good_qty / bad_qty），不把质检 ng_qty 重复计入报工数量。',
  '报工良品率 / 报工不良率不是真实 FPY：现有表无首次通过、返工与逐件流转数据。',
  '产线归属只能由工序任务推断；无任务关联的检验记录不纳入指定产线过滤。',
]
</script>

<template>
  <div class="page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>SPC 质量分析（B11）</span>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
      </template>

      <el-form :inline="true" class="filters" @submit.prevent>
        <el-form-item label="开始日期">
          <el-date-picker
            v-model="filters.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="结束日期">
          <el-date-picker
            v-model="filters.endDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="产线">
          <el-select v-model="filters.prodLine" style="width: 160px">
            <el-option v-for="item in prodLineOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="工序">
          <el-input v-model="filters.stepName" placeholder="按工序名称过滤（趋势）" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="fetchAll">查询</el-button>
          <el-button :icon="Refresh" @click="fetchAll">刷新</el-button>
        </el-form-item>
      </el-form>

      <el-alert type="info" :closable="false" class="scope-alert">
        <template #title>
          <span>统计区间为严格半开区间（Asia/Shanghai）；{{ snapshotText }}</span>
        </template>
      </el-alert>
    </el-card>

    <!-- Pareto -->
    <el-card class="block">
      <template #header>
        <div class="card-header">
          <span>不良品 Pareto（defect.qty）</span>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
      </template>

      <LoadingState v-if="paretoTask.loading.value" />
      <ErrorState v-else-if="paretoTask.error.value" :error="paretoTask.error.value" @retry="fetchAll" />
      <EmptyState
        v-else-if="paretoNoData"
        description="所选时间范围内没有不良记录（不以 0 冒充数据）"
      />
      <template v-else-if="paretoTask.data.value">
        <div class="pareto-chart" aria-label="不良品 Pareto 图">
          <div v-for="bar in paretoChart.bars" :key="bar.defectType" class="pareto-row">
            <span class="pareto-label" :title="bar.defectType">{{ bar.defectType }}</span>
            <span class="pareto-bar-track">
              <span class="pareto-bar" :style="{ width: `${bar.widthPercent}%` }" />
            </span>
            <span class="pareto-value">{{ bar.qty }}（{{ formatPercent(bar.share) }}）</span>
            <span class="pareto-cumulative">累计 {{ formatPercent(bar.cumulativeShare) }}</span>
          </div>
        </div>
        <el-table :data="paretoTask.data.value.items" size="small" class="table">
          <el-table-column prop="defectType" label="不良类型" min-width="120" />
          <el-table-column prop="qty" label="数量" width="100" />
          <el-table-column label="占比" width="110">
            <template #default="{ row }">{{ formatPercent(row.share) }}</template>
          </el-table-column>
          <el-table-column label="累计占比" width="110">
            <template #default="{ row }">{{ formatPercent(row.cumulativeShare) }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>

    <!-- 趋势 -->
    <el-card class="block">
      <template #header>
        <div class="card-header">
          <span>工序报工不良率趋势（reportBadRate）</span>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
      </template>

      <LoadingState v-if="trendTask.loading.value" />
      <ErrorState v-else-if="trendTask.error.value" :error="trendTask.error.value" @retry="fetchAll" />
      <EmptyState
        v-else-if="trendNoData"
        description="所选时间范围内没有报工数据（不以 0 冒充未知）"
      />
      <template v-else-if="trendTask.data.value">
        <svg
          v-if="trendChart.segments.length > 0"
          class="trend-chart"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label="报工不良率趋势折线图"
        >
          <polyline
            v-for="(segment, index) in trendChart.segments"
            :key="index"
            :points="segment"
            fill="none"
            stroke="#409eff"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <el-alert v-else type="info" :closable="false" title="趋势点均无有效报工数量，折线断开不绘制" />
        <el-table :data="trendTask.data.value.points" size="small" class="table">
          <el-table-column prop="date" label="日期" width="140" />
          <el-table-column prop="goodQty" label="报工良品数" width="120" />
          <el-table-column prop="badQty" label="报工不良数" width="120" />
          <el-table-column label="报工不良率" width="120">
            <template #default="{ row }">
              {{ row.badRate === null ? '暂无数据' : formatPercent(row.badRate) }}
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>

    <!-- 良品率 -->
    <el-card class="block">
      <template #header>
        <div class="card-header">
          <span>报工良品率（reportGoodRate）</span>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
      </template>

      <LoadingState v-if="goodRateTask.loading.value" />
      <ErrorState v-else-if="goodRateTask.error.value" :error="goodRateTask.error.value" @retry="fetchAll" />
      <EmptyState
        v-else-if="goodRateNoData"
        description="所选时间范围内没有报工数据，无法计算良品率（不以 0 冒充）"
      />
      <template v-else-if="goodRateTask.data.value">
        <div class="good-rate">
          <span class="good-rate-value">{{ formatPercent(goodRateTask.data.value.value) }}</span>
          <el-tag type="warning" size="small">isTrueFpy: false</el-tag>
        </div>
        <el-alert type="warning" :closable="false" title="这是报工良品率，不是真实 FPY：现有数据没有首次通过、返工与逐件流转记录。" />
      </template>
    </el-card>

    <el-card class="block">
      <template #header><span>口径与限制说明</span></template>
      <ul class="limitations">
        <li v-for="item in SPC_LIMITATIONS" :key="item">{{ item }}</li>
      </ul>
    </el-card>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.block {
  margin-top: 0;
}

.scope-alert {
  margin-top: 8px;
}

.pareto-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.pareto-row {
  display: grid;
  grid-template-columns: 120px 1fr 140px 140px;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.pareto-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pareto-bar-track {
  height: 14px;
  background: var(--el-fill-color-light, #f4f4f5);
  border-radius: 3px;
  overflow: hidden;
}

.pareto-bar {
  display: block;
  height: 100%;
  background: #f56c6c;
  border-radius: 3px;
}

.pareto-value,
.pareto-cumulative {
  color: var(--el-text-color-secondary, #909399);
}

.trend-chart {
  width: 100%;
  height: 180px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light, #f4f4f5);
  border-radius: 4px;
}

.table {
  margin-top: 8px;
}

.good-rate {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}

.good-rate-value {
  font-size: 32px;
  font-weight: 600;
}

.limitations {
  margin: 0;
  padding-left: 18px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
  line-height: 1.8;
}
</style>
