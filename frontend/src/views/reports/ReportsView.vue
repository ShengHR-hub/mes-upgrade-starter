<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Plus, Search, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

import { ReportsService, type Report } from '@/services/reports'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { showWriteError } from '@/services/write-feedback'
import type { PageResult } from '@/types/api'

import DataSourceTag from '@/components/DataSourceTag.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import EmptyState from '@/components/state/EmptyState.vue'

// ---------------------------------------------------------------- 列表异步任务
const listTask = useAsyncTask<PageResult<Report>>()
const route = useRoute()

const queryForm = reactive({
  taskId: '',
  workOrderId: '',
  prodLine: '',
  workshop: '',
  productCode: '',
  dateRange: null as [string, string] | null,
  page: 1,
  pageSize: 20,
})

function fetchList(): void {
  void listTask.run((signal) =>
    ReportsService.list(
      {
        page: queryForm.page,
        pageSize: queryForm.pageSize,
        taskId: queryForm.taskId.trim() || undefined,
        workOrderId: queryForm.workOrderId.trim() || undefined,
        startDate: queryForm.dateRange ? queryForm.dateRange[0] : undefined,
        endDate: queryForm.dateRange ? queryForm.dateRange[1] : undefined,
        prodLine: queryForm.prodLine.trim() || undefined,
        workshop: queryForm.workshop.trim() || undefined,
        productCode: queryForm.productCode.trim() || undefined,
      },
      signal,
    ),
  )
}

function handleSearch(): void {
  queryForm.page = 1
  fetchList()
}

function handleReset(): void {
  queryForm.taskId = ''
  queryForm.workOrderId = ''
  queryForm.prodLine = ''
  queryForm.workshop = ''
  queryForm.productCode = ''
  queryForm.dateRange = null
  handleSearch()
}

function handlePageChange(newPage: number): void {
  queryForm.page = newPage
  fetchList()
}

function handleSizeChange(newSize: number): void {
  queryForm.pageSize = newSize
  handleSearch()
}

// ---------------------------------------------------------------- 对话框与提交守卫
const dialogVisible = ref(false)
const formRef = ref<FormInstance>()
const { submitting: formSubmitting, run: runFormSubmit } = useSubmitGuard()

const form = reactive({
  taskId: '',
  goodQty: 0,
  badQty: 0,
})

const validateQuantities = (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
  if (form.goodQty + form.badQty <= 0) {
    callback(new Error('良品数量与不良品数量之和必须大于 0'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  taskId: [
    { required: true, message: '请输入工序任务ID', trigger: 'blur' },
    { pattern: /^[1-9]\d{0,18}$/, message: '任务ID必须为正整数且不超过 BIGINT 上限', trigger: 'blur' },
  ],
  goodQty: [
    { required: true, message: '请输入良品数量', trigger: 'blur' },
    { type: 'number', min: 0, max: 2147483647, message: '良品数量必须在 0 ~ 2147483647 之间', trigger: 'blur' },
    { validator: validateQuantities, trigger: 'change' },
  ],
  badQty: [
    { required: true, message: '请输入不良品数量', trigger: 'blur' },
    { type: 'number', min: 0, max: 2147483647, message: '不良品数量必须在 0 ~ 2147483647 之间', trigger: 'blur' },
    { validator: validateQuantities, trigger: 'change' },
  ],
}

function handleAdd(): void {
  form.taskId = ''
  form.goodQty = 0
  form.badQty = 0
  dialogVisible.value = true
  if (formRef.value) formRef.value.clearValidate()
}

function handleSubmit(): void {
  // 提交守卫：在任何 await 之前同步加锁，重复点击不会二次执行
  void runFormSubmit(async () => {
    const instance = formRef.value
    if (!instance) return
    const valid = await instance.validate().catch(() => false)
    if (!valid) return

    try {
      await ReportsService.create({
        taskId: form.taskId.trim(),
        goodQty: Number(form.goodQty),
        badQty: Number(form.badQty),
      })
      ElMessage.success('报工成功')
      dialogVisible.value = false
      fetchList()
    } catch (err) {
      showWriteError(err)
    }
  })
}

function syncFromRoute(): void {
  queryForm.workOrderId = typeof route.query.workOrderId === 'string' ? route.query.workOrderId : ''
  queryForm.taskId = typeof route.query.taskId === 'string' ? route.query.taskId : ''
  queryForm.prodLine = typeof route.query.prodLine === 'string' ? route.query.prodLine : ''
  queryForm.workshop = typeof route.query.workshop === 'string' ? route.query.workshop : ''
  queryForm.productCode = typeof route.query.productCode === 'string' ? route.query.productCode : ''
  if (
    typeof route.query.startDate === 'string' &&
    typeof route.query.endDate === 'string' &&
    route.query.startDate &&
    route.query.endDate
  ) {
    queryForm.dateRange = [route.query.startDate, route.query.endDate]
  } else {
    queryForm.dateRange = null
  }
  queryForm.page = 1
}

onMounted(() => {
  syncFromRoute()
  fetchList()
})

watch(
  () => route.query,
  () => {
    syncFromRoute()
    fetchList()
  },
)
</script>

<template>
  <div class="reports-view">
    <el-card class="box-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span class="title">生产报工</span>
          <div class="actions">
            <el-button type="primary" :icon="Plus" @click="handleAdd">新增报工</el-button>
          </div>
        </div>
      </template>

      <el-form :model="queryForm" inline class="query-form">
        <el-form-item label="任务ID">
          <el-input v-model="queryForm.taskId" placeholder="请输入任务ID" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item label="工单ID">
          <el-input v-model="queryForm.workOrderId" placeholder="请输入工单ID" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item label="报工日期">
          <el-date-picker
            v-model="queryForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">搜索</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 统一状态展示：加载态 / 错误态 / 空态 / 数据表 -->
      <LoadingState v-if="listTask.loading.value" />
      <ErrorState
        v-else-if="listTask.error.value"
        :error="listTask.error.value"
        retryable
        @retry="fetchList"
      />
      <EmptyState
        v-else-if="(listTask.data.value?.list.length ?? 0) === 0"
        text="没有符合条件的报工记录"
      />
      <template v-else>
        <el-table :data="listTask.data.value?.list ?? []" style="width: 100%" border stripe size="small">
          <el-table-column prop="id" label="报工ID" width="100" />
          <el-table-column prop="taskId" label="工序任务ID" width="120" />
          <el-table-column prop="userId" label="操作员ID" width="100" />
          <el-table-column prop="goodQty" label="良品数量" width="100" align="right" />
          <el-table-column prop="badQty" label="不良品数量" width="100" align="right" />
          <el-table-column prop="reportedAt" label="报工时间" min-width="190" />
          <el-table-column label="数据源" width="130">
            <template #default="{ row }">
              <DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" />
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-container">
          <el-pagination
            :current-page="queryForm.page"
            :page-size="queryForm.pageSize"
            :total="listTask.data.value?.total ?? 0"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @size-change="handleSizeChange"
            @current-change="handlePageChange"
          />
        </div>
      </template>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增报工" width="500px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="任务ID" prop="taskId">
          <el-input v-model="form.taskId" placeholder="请输入任务十进制 BIGINT ID" />
        </el-form-item>
        <el-form-item label="良品数量" prop="goodQty">
          <el-input-number v-model="form.goodQty" :min="0" :max="2147483647" :step="1" />
        </el-form-item>
        <el-form-item label="不良品数量" prop="badQty">
          <el-input-number v-model="form.badQty" :min="0" :max="2147483647" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="formSubmitting" @click="handleSubmit">确认提交</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.reports-view {
  padding: 16px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.title {
  font-size: 16px;
  font-weight: bold;
}
.query-form {
  margin-bottom: 16px;
}
.pagination-container {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
