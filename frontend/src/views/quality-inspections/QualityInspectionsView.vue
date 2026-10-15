<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Plus, Search, Refresh, Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

import {
  QualityInspectionsService,
  type QualityInspection,
  type CreateDefectItemDto,
} from '@/services/quality-inspections'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { showWriteError } from '@/services/write-feedback'
import type { PageResult } from '@/types/api'

import DataSourceTag from '@/components/DataSourceTag.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import EmptyState from '@/components/state/EmptyState.vue'

// ---------------------------------------------------------------- 列表任务
const listTask = useAsyncTask<PageResult<QualityInspection>>()
const route = useRoute()

const queryForm = reactive({
  workOrderId: '',
  taskId: '',
  result: '' as 'OK' | 'NG' | '',
  prodLine: '',
  workshop: '',
  productCode: '',
  dateRange: null as [string, string] | null,
  page: 1,
  pageSize: 20,
})

function fetchList(): void {
  void listTask.run((signal) =>
    QualityInspectionsService.list(
      {
        page: queryForm.page,
        pageSize: queryForm.pageSize,
        workOrderId: queryForm.workOrderId.trim() || undefined,
        taskId: queryForm.taskId.trim() || undefined,
        result: queryForm.result || undefined,
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
  queryForm.workOrderId = ''
  queryForm.taskId = ''
  queryForm.result = ''
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

// ---------------------------------------------------------------- 对话框与表单
const dialogVisible = ref(false)
const formRef = ref<FormInstance>()
const { submitting: formSubmitting, run: runFormSubmit } = useSubmitGuard()

const form = reactive({
  workOrderId: '',
  taskId: '',
  result: 'OK' as 'OK' | 'NG',
  checkQty: 1,
  ngQty: 0,
  remark: '',
  defects: [] as CreateDefectItemDto[],
})

const defectTotalQty = computed(() => {
  return form.defects.reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0)
})

function onResultChange(val: string): void {
  if (val === 'OK') {
    form.ngQty = 0
    form.defects = []
  } else {
    if (form.ngQty <= 0) form.ngQty = 1
    if (form.defects.length === 0) {
      form.defects = [{ defectType: '虚焊', qty: 1, description: '' }]
    }
  }
}

function addDefectItem(): void {
  form.defects.push({ defectType: '', qty: 1, description: '' })
}

function removeDefectItem(index: number): void {
  form.defects.splice(index, 1)
}

const validateCheckQty = (_rule: unknown, value: number, callback: (error?: Error) => void) => {
  if (!value || value <= 0) {
    callback(new Error('送检数量必须为正整数'))
  } else {
    callback()
  }
}

const validateNgQty = (_rule: unknown, value: number, callback: (error?: Error) => void) => {
  if (form.result === 'NG') {
    if (value <= 0) {
      callback(new Error('NG结果不良数量必须大于 0'))
    } else if (value > form.checkQty) {
      callback(new Error('不良数量不得大于送检数量'))
    } else if (defectTotalQty.value !== value) {
      callback(new Error(`不良明细数量之和 (${defectTotalQty.value}) 必须等于不良数量 (${value})`))
    } else {
      callback()
    }
  } else {
    if (value !== 0) {
      callback(new Error('OK结果不良数量必须为 0'))
    } else {
      callback()
    }
  }
}

const rules: FormRules = {
  workOrderId: [
    { required: true, message: '请输入工单ID', trigger: 'blur' },
    { pattern: /^[1-9]\d{0,18}$/, message: '工单ID必须为正整数且不超过 BIGINT 上限', trigger: 'blur' },
  ],
  taskId: [
    { pattern: /^[1-9]\d{0,18}$/, message: '任务ID必须为正整数且不超过 BIGINT 上限', trigger: 'blur' },
  ],
  result: [{ required: true, message: '请选择检验结果', trigger: 'change' }],
  checkQty: [
    { required: true, message: '请输入送检数量', trigger: 'blur' },
    { validator: validateCheckQty, trigger: 'blur' },
  ],
  ngQty: [{ validator: validateNgQty, trigger: 'change' }],
}

function handleAdd(): void {
  form.workOrderId = ''
  form.taskId = ''
  form.result = 'OK'
  form.checkQty = 1
  form.ngQty = 0
  form.remark = ''
  form.defects = []
  dialogVisible.value = true
  if (formRef.value) formRef.value.clearValidate()
}

function handleSubmit(): void {
  // 提交守卫：在任何 await 之前同步加锁，避免重复提交
  void runFormSubmit(async () => {
    const instance = formRef.value
    if (!instance) return
    const valid = await instance.validate().catch(() => false)
    if (!valid) return

    if (form.result === 'NG') {
      if (form.defects.length === 0) {
        ElMessage.warning('NG检验必须录入至少一项不良品明细')
        return
      }
      for (const d of form.defects) {
        if (!d.defectType.trim()) {
          ElMessage.warning('不良类型不能为空')
          return
        }
        if (!d.qty || d.qty <= 0) {
          ElMessage.warning('不良数量必须大于 0')
          return
        }
      }
      if (defectTotalQty.value !== form.ngQty) {
        ElMessage.warning(`不良明细数量总和 (${defectTotalQty.value}) 必须等于不良数量 (${form.ngQty})`)
        return
      }
    }

    try {
      const payload = {
        workOrderId: form.workOrderId.trim(),
        taskId: form.taskId.trim() || undefined,
        result: form.result,
        checkQty: Number(form.checkQty),
        ngQty: form.result === 'OK' ? 0 : Number(form.ngQty),
        remark: form.remark.trim() || undefined,
        defects:
          form.result === 'NG'
            ? form.defects.map((d) => ({
                defectType: d.defectType.trim(),
                qty: Number(d.qty),
                description: d.description?.trim() || undefined,
              }))
            : undefined,
      }
      await QualityInspectionsService.create(payload)
      ElMessage.success('录入质量检验记录成功')
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
  queryForm.result =
    typeof route.query.result === 'string' &&
    (route.query.result === 'OK' || route.query.result === 'NG')
      ? (route.query.result as 'OK' | 'NG')
      : ''
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
  <div class="quality-inspections-view">
    <el-card class="box-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span class="title">质量检验</span>
          <div class="actions">
            <el-button type="primary" :icon="Plus" @click="handleAdd">录入检验</el-button>
          </div>
        </div>
      </template>

      <el-form :model="queryForm" inline class="query-form">
        <el-form-item label="工单ID">
          <el-input v-model="queryForm.workOrderId" placeholder="请输入工单ID" clearable />
        </el-form-item>
        <el-form-item label="任务ID">
          <el-input v-model="queryForm.taskId" placeholder="请输入任务ID" clearable />
        </el-form-item>
        <el-form-item label="检验结果">
          <el-select v-model="queryForm.result" placeholder="全部" clearable style="width: 120px">
            <el-option label="OK" value="OK" />
            <el-option label="NG" value="NG" />
          </el-select>
        </el-form-item>
        <el-form-item label="检验日期">
          <el-date-picker
            v-model="queryForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">搜索</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 统一状态：加载态 / 错误态 / 空态 / 表格 -->
      <LoadingState v-if="listTask.loading.value" />
      <ErrorState
        v-else-if="listTask.error.value"
        :error="listTask.error.value"
        retryable
        @retry="fetchList"
      />
      <EmptyState
        v-else-if="(listTask.data.value?.list.length ?? 0) === 0"
        text="没有符合条件的检验记录"
      />
      <template v-else>
        <el-table :data="listTask.data.value?.list ?? []" style="width: 100%" border stripe size="small">
          <el-table-column prop="id" label="检验ID" width="90" />
          <el-table-column prop="workOrderId" label="工单ID" width="100" />
          <el-table-column prop="taskId" label="任务ID" width="100">
            <template #default="{ row }">
              {{ row.taskId ?? '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="result" label="结果" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.result === 'OK' ? 'success' : 'danger'" size="small">
                {{ row.result }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="checkQty" label="送检数量" width="95" align="right" />
          <el-table-column prop="ngQty" label="不良数量" width="95" align="right" />
          <el-table-column label="不良明细" min-width="160">
            <template #default="{ row }">
              <template v-if="row.defects && row.defects.length > 0">
                <el-tag
                  v-for="d in row.defects"
                  :key="d.id"
                  size="small"
                  type="danger"
                  class="defect-tag"
                >
                  {{ d.defectType }}: {{ d.qty }}
                </el-tag>
              </template>
              <span v-else-if="row.result === 'NG'">-</span>
              <span v-else class="text-muted">无</span>
            </template>
          </el-table-column>
          <el-table-column prop="checkedAt" label="检验时间" width="185" />
          <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
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

    <el-dialog v-model="dialogVisible" title="录入检验记录" width="620px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="工单ID" prop="workOrderId">
          <el-input v-model="form.workOrderId" placeholder="请输入工单十进制 BIGINT ID" />
        </el-form-item>
        <el-form-item label="任务ID" prop="taskId">
          <el-input v-model="form.taskId" placeholder="过程检请填关联任务ID，选填" />
        </el-form-item>
        <el-form-item label="检验结果" prop="result">
          <el-radio-group v-model="form.result" @change="onResultChange">
            <el-radio-button label="OK">OK（合格）</el-radio-button>
            <el-radio-button label="NG">NG（不合格）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="送检数量" prop="checkQty">
          <el-input-number v-model="form.checkQty" :min="1" :max="2147483647" :step="1" />
        </el-form-item>
        <el-form-item v-if="form.result === 'NG'" label="不良数量" prop="ngQty">
          <el-input-number
            v-model="form.ngQty"
            :min="1"
            :max="form.checkQty"
            :step="1"
          />
        </el-form-item>

        <!-- NG 场景下的真实缺陷录入 -->
        <div v-if="form.result === 'NG'" class="defect-section">
          <div class="defect-header">
            <span class="defect-title">不良明细列表（须录入具体不良类型，数量之和等于不良数量）</span>
            <el-button type="primary" link size="small" :icon="Plus" @click="addDefectItem">
              添加明细
            </el-button>
          </div>

          <div v-for="(item, idx) in form.defects" :key="idx" class="defect-row">
            <el-input
              v-model="item.defectType"
              placeholder="不良类型（如虚焊、错件、划伤）"
              maxlength="32"
              style="width: 190px"
            />
            <el-input-number
              v-model="item.qty"
              :min="1"
              :max="form.ngQty"
              placeholder="数量"
              style="width: 120px"
            />
            <el-input
              v-model="item.description"
              placeholder="描述（选填）"
              maxlength="256"
              style="flex: 1"
            />
            <el-button
              type="danger"
              link
              :icon="Delete"
              :disabled="form.defects.length <= 1"
              @click="removeDefectItem(idx)"
            />
          </div>
          <div class="defect-summary">
            已录入明细数量之和：<strong>{{ defectTotalQty }}</strong> / 所需不良数量：<strong>{{ form.ngQty }}</strong>
          </div>
        </div>

        <el-form-item label="备注说明" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="256" show-word-limit />
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
.quality-inspections-view {
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
.defect-tag {
  margin-right: 6px;
  margin-bottom: 4px;
}
.text-muted {
  color: #909399;
}
.defect-section {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 16px;
}
.defect-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.defect-title {
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}
.defect-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.defect-summary {
  font-size: 12px;
  color: #909399;
  text-align: right;
  margin-top: 4px;
}
</style>
