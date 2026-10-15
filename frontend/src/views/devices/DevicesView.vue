<script setup lang="ts">
/**
 * B7 设备管理（契约 §6.7）。
 *
 * 边界：
 * - OEE 缺关键输入（计划生产时间 / 设备产出归属 / 理想节拍）时，接口返回
 *   `oee = null` + `insufficient_data` + `missingInputs`。本页展示缺失项说明，
 *   **不把 null 显示成 0**，不用随机数、默认值或产线良品率冒充 OEE；
 * - 状态变更入口在 Q3 批准前保持关闭：页面提供入口仅为如实展示服务端
 *   30006 拒绝原因，**不伪造本地状态变更**；
 * - 日期区间沿用现有统一口径（半开区间，边界不漏算）。
 */
import { Refresh, Search } from '@element-plus/icons-vue'
import { computed, reactive, ref } from 'vue'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { devicesService } from '@/services/devices'
import { showApiError, showInfo, showWarning } from '@/services/notify'
import { useAuthStore } from '@/stores/auth'
import type { PageResult } from '@/types/api'
import type { Device, DeviceOee, DeviceStateLog } from '@/types/device'

const auth = useAuthStore()

const listTask = useAsyncTask<PageResult<Device>>()
const logTask = useAsyncTask<PageResult<DeviceStateLog>>()
const oeeTask = useAsyncTask<DeviceOee>()

const canReadOee = computed(() => auth.can('devices:oee:read'))

const query = reactive({ keyword: '', workshop: '', prodLine: '', status: '' })
const current = ref<Device | null>(null)
const detailVisible = ref(false)
const logRange = ref<[string, string] | null>(null)
const { submitting: transitionSubmitting, run: runTransition } = useSubmitGuard()

const transitionForm = reactive({ expectedStatus: '', targetStatus: '', remark: '' })
const transitionVisible = ref(false)

function fetchList(): void {
  void listTask.run((signal) =>
    devicesService.list(
      {
        keyword: query.keyword.trim() || undefined,
        workshop: query.workshop.trim() || undefined,
        prodLine: query.prodLine.trim() || undefined,
        status: query.status || undefined,
        page: 1,
        pageSize: 50,
      },
      signal,
    ),
  )
}

function openDevice(row: Device): void {
  current.value = row
  detailVisible.value = true
  fetchLogs()
  if (canReadOee.value) {
    void oeeTask.run((signal) => devicesService.oee(row.code, signal))
  }
}

function fetchLogs(): void {
  const device = current.value
  if (!device) return
  void logTask.run((signal) =>
    devicesService.listStateLogs(
      device.code,
      {
        startDate: logRange.value ? logRange.value[0] : undefined,
        endDate: logRange.value ? logRange.value[1] : undefined,
        page: 1,
        pageSize: 50,
      },
      signal,
    ),
  )
}

function openTransition(): void {
  const device = current.value
  if (!device) return
  transitionForm.expectedStatus = device.status
  transitionForm.targetStatus = ''
  transitionForm.remark = ''
  transitionVisible.value = true
}

function submitTransition(): void {
  const device = current.value
  if (!device) return
  if (!transitionForm.targetStatus) {
    showWarning('请选择目标状态')
    return
  }
  if (transitionForm.targetStatus === transitionForm.expectedStatus) {
    showWarning('目标状态与当前状态相同')
    return
  }
  void runTransition(async () => {
    try {
      await devicesService.transition(device.code, {
        expectedStatus: transitionForm.expectedStatus,
        targetStatus: transitionForm.targetStatus,
        remark: transitionForm.remark.trim() || undefined,
      })
      showInfo('设备状态已更新')
      transitionVisible.value = false
      fetchList()
      const refreshed = listTask.data.value?.list.find((item) => item.code === device.code)
      if (refreshed) {
        current.value = refreshed
        fetchLogs()
      }
    } catch (error) {
      // Q3 未批准时服务端一律返回 30006；如实展示，不改写本地状态
      showApiError(error)
    }
  })
}

function formatOee(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(2)}%`
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h2 class="page__title">设备管理</h2>
        <p class="page__summary">
          设备台账、状态日志与 OEE 查询。OEE 缺关键输入时返回缺失项说明，不用默认值编造；
          状态变更流转表（Q3）批准前，写入入口保持关闭。
        </p>
      </div>
      <el-button :icon="Refresh" @click="fetchList">刷新</el-button>
    </header>

    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="编码 / 名称关键词" style="width: 220px" clearable />
      <el-input v-model="query.workshop" placeholder="车间" style="width: 150px" clearable />
      <el-input v-model="query.prodLine" placeholder="产线" style="width: 150px" clearable />
      <el-select v-model="query.status" placeholder="状态" style="width: 140px" clearable>
        <el-option label="运行中" value="运行中" />
        <el-option label="待机" value="待机" />
        <el-option label="维修中" value="维修中" />
        <el-option label="停机" value="停机" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="fetchList">查询</el-button>
    </div>

    <LoadingState v-if="listTask.loading.value" />
    <ErrorState v-else-if="listTask.error.value" :error="listTask.error.value" retryable @retry="fetchList" />
    <EmptyState v-else-if="!listTask.data.value || listTask.data.value.list.length === 0" description="暂无设备台账数据。" />
    <el-table v-else :data="listTask.data.value.list" border size="small" @row-click="openDevice">
      <el-table-column prop="code" label="设备编码" min-width="140" />
      <el-table-column prop="name" label="名称" min-width="120" />
      <el-table-column prop="workshop" label="车间" width="110" />
      <el-table-column prop="prodLine" label="产线" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === '维修中' ? 'danger' : row.status === '运行中' ? 'success' : 'info'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="数据来源" width="150">
        <template #default="{ row }">
          <DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" />
          <el-tag v-if="row.statusDataSource === 'demo'" size="small" effect="plain" type="warning">
            状态为演示口径
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- -------------------------------------------------- 设备详情 -->
    <el-dialog v-model="current" :title="current ? `${current.code} ${current.name}` : '设备详情'" width="760px">
      <template v-if="current">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="设备编码">{{ current.code }}</el-descriptions-item>
          <el-descriptions-item label="名称">{{ current.name }}</el-descriptions-item>
          <el-descriptions-item label="车间">{{ current.workshop }}</el-descriptions-item>
          <el-descriptions-item label="产线">{{ current.prodLine ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ current.status }}</el-descriptions-item>
          <el-descriptions-item label="购置年份">{{ current.purchaseYear ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="供应商">{{ current.supplier ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ current.remark ?? '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="block-title">OEE（仅 admin / manager 可查询）</h4>
        <template v-if="!canReadOee">
          <p class="note">当前角色不可查询 OEE（契约 §5.2：devices:oee:read 仅 admin / manager）。</p>
        </template>
        <template v-else-if="oeeTask.loading.value">
          <LoadingState />
        </template>
        <template v-else-if="oeeTask.error.value">
          <ErrorState :error="oeeTask.error.value" />
        </template>
        <template v-else-if="oeeTask.data.value">
          <template v-if="oeeTask.data.value.calculationStatus === 'insufficient_data'">
            <el-alert type="warning" :closable="false" show-icon title="关键输入不足，OEE 不可计算">
              <p>缺少输入：</p>
              <ul class="limitations">
                <li v-for="(item, index) in oeeTask.data.value.missingInputs" :key="index">{{ item }}</li>
              </ul>
              <p>设备未提供以下任一输入时不计算 OEE，不用默认值或随机数占位。</p>
            </el-alert>
          </template>
          <el-descriptions v-else :column="4" border size="small">
            <el-descriptions-item label="时间开动率">{{ formatOee(oeeTask.data.value.availability) }}</el-descriptions-item>
            <el-descriptions-item label="性能开动率">{{ formatOee(oeeTask.data.value.performance) }}</el-descriptions-item>
            <el-descriptions-item label="合格品率">{{ formatOee(oeeTask.data.value.quality) }}</el-descriptions-item>
            <el-descriptions-item label="OEE">{{ formatOee(oeeTask.data.value.oee) }}</el-descriptions-item>
          </el-descriptions>
        </template>

        <h4 class="block-title">状态日志（只读）</h4>
        <div class="toolbar">
          <el-date-picker
            v-model="logRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
          />
          <el-button :icon="Search" @click="fetchLogs">查询</el-button>
          <el-button @click="openTransition">状态变更（入口关闭）</el-button>
        </div>
        <LoadingState v-if="logTask.loading.value" />
        <ErrorState v-else-if="logTask.error.value" :error="logTask.error.value" retryable @retry="fetchLogs" />
        <EmptyState
          v-else-if="!logTask.data.value || logTask.data.value.list.length === 0"
          description="该设备暂无状态变更记录。"
        />
        <el-table v-else :data="logTask.data.value.list" border size="small" max-height="220">
          <el-table-column prop="oldStatus" label="原状态" width="100" />
          <el-table-column prop="newStatus" label="新状态" width="100" />
          <el-table-column prop="changedBy" label="操作人" width="110" />
          <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
          <el-table-column prop="changedAt" label="变更时间" min-width="170" />
        </el-table>
      </template>
    </el-dialog>

    <!-- -------------------------------------------------- 状态变更（Q3 未批准，服务端返回 30006） -->
    <el-dialog v-model="transitionVisible" title="设备状态变更" width="480px">
      <el-form label-width="110px">
        <el-form-item label="当前状态">
          <span>{{ transitionForm.expectedStatus }}</span>
        </el-form-item>
        <el-form-item label="目标状态">
          <el-select v-model="transitionForm.targetStatus" placeholder="请选择目标状态">
            <el-option label="运行中" value="运行中" />
            <el-option label="待机" value="待机" />
            <el-option label="维修中" value="维修中" />
            <el-option label="停机" value="停机" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="transitionForm.remark" placeholder="可留空" />
        </el-form-item>
      </el-form>
      <p class="note">
        允许的状态流转表与停机超时阈值（Q3）尚未获批准，服务端对任何流转返回
        30006（功能未启用）。本入口保留用于如实展示拒绝原因，不伪造本地状态变更。
      </p>
      <template #footer>
        <el-button @click="transitionVisible = false">取消</el-button>
        <el-button type="primary" :loading="transitionSubmitting" @click="submitTransition">
          提交
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mes-space-2);
  margin-bottom: var(--mes-space-3);
  align-items: center;
}

.block-title {
  margin: var(--mes-space-4) 0 var(--mes-space-2);
  font-size: var(--mes-font-size-md);
}

.limitations {
  margin: 0;
  padding-left: 1.2em;
}

.note {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
}
</style>
