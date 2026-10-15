<script setup lang="ts">
/**
 * B6 SN 追溯（契约 §6.6）。
 *
 * 边界声明（页面上必须常驻）：
 * - SN 是**精确查询**，不用模糊结果冒充唯一追溯；
 * - `productCode` 由服务端取自工单，前端不构造；
 * - 一个 SN 只有一个当前快照、一个批次；
 * - 工单工序 / 检验仅作**关联上下文**展示，不宣称逐工序、逐件已证实历史；
 * - 导出为 JSON，保留 coverage / limitations / 数据来源，不宣称满足 IATF 16949。
 */
import { Download, Refresh, Search } from '@element-plus/icons-vue'
import { computed, reactive, ref } from 'vue'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { snTracesService } from '@/services/sn-traces'
import { showApiError, showInfo, showWarning } from '@/services/notify'
import { showWriteError } from '@/services/write-feedback'
import { useAuthStore } from '@/stores/auth'
import { downloadJsonExport } from '@/utils/sn-export'
import type { PageResult } from '@/types/api'
import type { SnTrace, SnTraceDetail } from '@/types/material'

const auth = useAuthStore()

const listTask = useAsyncTask<PageResult<SnTrace>>()
const detailTask = useAsyncTask<SnTraceDetail>()
const { submitting: writeSubmitting, run: runWrite } = useSubmitGuard()

const listQuery = reactive({ sn: '', workOrderId: '', batchId: '', page: 1, pageSize: 20 })
const currentSn = ref('')
const detailVisible = ref(false)

const canWrite = computed(() => auth.can('sn-traces:write'))
const canExport = computed(() => auth.can('sn-traces:export'))

function fetchList(): void {
  void listTask.run((signal) =>
    snTracesService.list(
      {
        sn: listQuery.sn.trim() || undefined,
        workOrderId: listQuery.workOrderId.trim() || undefined,
        batchId: listQuery.batchId.trim() || undefined,
        page: listQuery.page,
        pageSize: listQuery.pageSize,
      },
      signal,
    ),
  )
}

function openDetail(row: SnTrace): void {
  currentSn.value = row.sn
  detailVisible.value = true
  void detailTask.run((signal) => snTracesService.detail(row.sn, signal))
}

function closeDetail(): void {
  detailVisible.value = false
  detailTask.reset()
}

// ---------------------------------------------------------------- 快照更新
const editVisible = ref(false)
const editForm = reactive<{ sn: string; taskId: string; deviceCode: string; batchId: string; qcResult: 'OK' | 'NG' | '' }>({
  sn: '',
  taskId: '',
  deviceCode: '',
  batchId: '',
  qcResult: '',
})

function openEdit(row: SnTrace): void {
  editForm.sn = row.sn
  editForm.taskId = row.taskId ?? ''
  editForm.deviceCode = row.deviceCode ?? ''
  editForm.batchId = row.batchId ?? ''
  editForm.qcResult = row.qcResult ?? ''
  editVisible.value = true
}

function submitEdit(): void {
  const payload: {
    taskId?: string
    deviceCode?: string
    batchId?: string
    qcResult?: 'OK' | 'NG'
  } = {}
  if (editForm.taskId.trim()) payload.taskId = editForm.taskId.trim()
  if (editForm.deviceCode.trim()) payload.deviceCode = editForm.deviceCode.trim()
  if (editForm.batchId.trim()) payload.batchId = editForm.batchId.trim()
  if (editForm.qcResult) payload.qcResult = editForm.qcResult
  if (Object.keys(payload).length === 0) {
    showWarning('至少填写一个要更新的快照字段')
    return
  }
  void runWrite(async () => {
    try {
      await snTracesService.update(editForm.sn, payload)
      showInfo(`已更新 ${editForm.sn} 的当前快照（producedAt 不可修改）`)
      editVisible.value = false
      fetchList()
      if (currentSn.value === editForm.sn) {
        void detailTask.run((signal) => snTracesService.detail(editForm.sn, signal))
      }
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- JSON 导出
const exportSubmitting = useSubmitGuard()

function exportCurrent(): void {
  const sn = currentSn.value
  if (!sn) return
  void exportSubmitting.run(async () => {
    try {
      const result = await snTracesService.export(sn)
      const ok = downloadJsonExport(result.fileName, result.content)
      if (ok) {
        showInfo('已生成 JSON 追溯文件（含覆盖率与限制说明）')
      } else {
        showWarning('当前环境不支持浏览器下载，请改用后端返回的 JSON 内容')
      }
    } catch (error) {
      showApiError(error)
    }
  })
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h2 class="page__title">SN 追溯</h2>
        <p class="page__summary">
          SN 精确查询，一个 SN 只有一个当前快照与一个批次。工单工序与检验仅作关联上下文，
          不构成逐工序、逐件已证实历史；导出为 JSON，保留覆盖率与限制说明，不宣称满足 IATF 16949。
        </p>
      </div>
      <el-button :icon="Refresh" @click="fetchList">刷新</el-button>
    </header>

    <div class="toolbar">
      <el-input v-model="listQuery.sn" placeholder="SN（精确匹配）" style="width: 220px" clearable />
      <el-input v-model="listQuery.workOrderId" placeholder="工单 ID" style="width: 180px" clearable />
      <el-input v-model="listQuery.batchId" placeholder="批次 ID" style="width: 160px" clearable />
      <el-button type="primary" :icon="Search" @click="fetchList">查询</el-button>
    </div>

    <LoadingState v-if="listTask.loading.value" />
    <ErrorState
      v-else-if="listTask.error.value"
      :error="listTask.error.value"
      retryable
      @retry="fetchList"
    />
    <EmptyState
      v-else-if="!listTask.data.value || listTask.data.value.list.length === 0"
      description="没有匹配的 SN。SN 为精确匹配，不使用模糊结果冒充唯一追溯。"
    />
    <el-table v-else :data="listTask.data.value.list" border size="small" @row-click="openDetail">
      <el-table-column prop="sn" label="SN" min-width="180" />
      <el-table-column prop="workOrderId" label="工单 ID" min-width="110" />
      <el-table-column prop="productCode" label="产品编码" min-width="130" />
      <el-table-column prop="taskId" label="工序任务 ID" min-width="120" />
      <el-table-column prop="deviceCode" label="设备" min-width="120" />
      <el-table-column prop="batchId" label="批次 ID" min-width="100" />
      <el-table-column prop="qcResult" label="检验结果" width="100" />
      <el-table-column prop="producedAt" label="生产时间" min-width="170" />
      <el-table-column label="数据来源" width="130">
        <template #default="{ row }"><DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" /></template>
      </el-table-column>
      <el-table-column v-if="canWrite" label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openEdit(row)">更新快照</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- -------------------------------------------------- 详情 -->
    <el-dialog v-model="detailVisible" :title="`SN 追溯详情：${currentSn}`" width="720px">
      <template v-if="detailTask.loading.value">
        <LoadingState />
      </template>
      <template v-else-if="detailTask.error.value">
        <ErrorState :error="detailTask.error.value" />
      </template>
      <template v-else-if="detailTask.data.value">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="SN">{{ detailTask.data.value.trace.sn }}</el-descriptions-item>
          <el-descriptions-item label="工单 ID">{{ detailTask.data.value.trace.workOrderId }}</el-descriptions-item>
          <el-descriptions-item label="产品编码（取自工单）">
            {{ detailTask.data.value.trace.productCode }}
          </el-descriptions-item>
          <el-descriptions-item label="生产时间">{{ detailTask.data.value.trace.producedAt ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="工序任务">{{ detailTask.data.value.trace.taskId ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="设备">{{ detailTask.data.value.trace.deviceCode ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="批次">{{ detailTask.data.value.trace.batchId ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="检验结果">{{ detailTask.data.value.trace.qcResult ?? '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="block-title">关联上下文（仅参考，不是已证实历史）</h4>
        <el-table :data="detailTask.data.value.context.tasks" border size="small" max-height="180">
          <el-table-column
            v-for="col in Object.keys(detailTask.data.value.context.tasks[0] ?? { id: 'ID' })"
            :key="col"
            :prop="col"
            :label="col"
            min-width="110"
          />
        </el-table>
        <el-table
          class="context-table"
          :data="detailTask.data.value.context.inspections"
          border
          size="small"
          max-height="180"
        >
          <el-table-column
            v-for="col in Object.keys(detailTask.data.value.context.inspections[0] ?? { id: 'ID' })"
            :key="col"
            :prop="col"
            :label="col"
            min-width="110"
          />
        </el-table>

        <h4 class="block-title">覆盖率</h4>
        <p class="note">{{ detailTask.data.value.coverage }}</p>
        <h4 class="block-title">限制说明</h4>
        <ul class="limitations">
          <li v-for="(item, index) in detailTask.data.value.limitations" :key="index">{{ item }}</li>
        </ul>
      </template>

      <template #footer>
        <el-button @click="closeDetail">关闭</el-button>
        <el-button
          v-if="canExport"
          type="primary"
          :icon="Download"
          :loading="exportSubmitting.submitting.value"
          @click="exportCurrent"
        >
          导出 JSON
        </el-button>
      </template>
    </el-dialog>

    <!-- -------------------------------------------------- 快照更新 -->
    <el-dialog v-model="editVisible" title="更新当前快照" width="520px">
      <el-form label-width="110px">
        <el-form-item label="SN">
          <span>{{ editForm.sn }}</span>
        </el-form-item>
        <el-form-item label="工序任务 ID">
          <el-input v-model="editForm.taskId" placeholder="必须属于该工单" />
        </el-form-item>
        <el-form-item label="设备编码">
          <el-input v-model="editForm.deviceCode" placeholder="必须真实存在" />
        </el-form-item>
        <el-form-item label="批次 ID">
          <el-input v-model="editForm.batchId" placeholder="必须真实存在" />
        </el-form-item>
        <el-form-item label="检验结果">
          <el-select v-model="editForm.qcResult" placeholder="不修改可留空" clearable>
            <el-option label="OK" value="OK" />
            <el-option label="NG" value="NG" />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="note">生产时间 producedAt 不可修改，不伪造过去事件。</p>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="writeSubmitting" @click="submitEdit">保存</el-button>
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
}

.block-title {
  margin: var(--mes-space-4) 0 var(--mes-space-2);
  font-size: var(--mes-font-size-md);
}

.context-table {
  margin-top: var(--mes-space-2);
}

.limitations {
  margin: 0;
  padding-left: 1.2em;
  color: var(--mes-text-secondary);
  line-height: 1.8;
}

.note {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
}
</style>
