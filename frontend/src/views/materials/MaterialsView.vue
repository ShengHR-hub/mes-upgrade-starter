<script setup lang="ts">
/**
 * B5 物料管理（契约 §6.6）。
 *
 * 边界：
 * - BOM `qty` 是精确十进制字符串，输入与展示都按字符串处理，不做数值计算；
 * - `level` 不代表父子关系，本页不推断多层 BOM 树；
 * - 批次 `qty` 仅表示入库数量，不等于可用库存（本页不出库、不扣库存、不算料）；
 * - 有已确认订单 / 工单关联时，服务端按契约返回 30004 保护，前端如实展示。
 */
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { computed, reactive, ref } from 'vue'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { useAuthStore } from '@/stores/auth'
import { showInfo, showWarning } from '@/services/notify'
import { showWriteError } from '@/services/write-feedback'
import { bomsService, materialBatchesService, materialsService } from '@/services/materials'
import type { PageResult } from '@/types/api'
import type {
  Bom,
  CreateBomPayload,
  CreateMaterialBatchPayload,
  Material,
  MaterialBatch,
  SnTrace,
} from '@/types/material'

const auth = useAuthStore()

// ---------------------------------------------------------------- 列表任务
const materialsTask = useAsyncTask<PageResult<Material>>()
const bomsTask = useAsyncTask<PageResult<Bom>>()
const batchesTask = useAsyncTask<PageResult<MaterialBatch>>()
const reverseTask = useAsyncTask<PageResult<SnTrace>>()

const materialQuery = reactive({ keyword: '', category: '' })
const productCode = ref('JC-PLC-2001')
const batchQuery = reactive({ materialCode: '', batchNo: '' })

function fetchMaterials(): void {
  void materialsTask.run((signal) =>
    materialsService.list(
      {
        keyword: materialQuery.keyword.trim() || undefined,
        category: materialQuery.category.trim() || undefined,
        page: 1,
        pageSize: 50,
      },
      signal,
    ),
  )
}

function fetchBoms(): void {
  void bomsTask.run((signal) =>
    bomsService.list(productCode.value.trim(), { page: 1, pageSize: 100 }, signal),
  )
}

function fetchBatches(): void {
  void batchesTask.run((signal) =>
    materialBatchesService.list(
      {
        materialCode: batchQuery.materialCode.trim() || undefined,
        batchNo: batchQuery.batchNo.trim() || undefined,
        page: 1,
        pageSize: 50,
      },
      signal,
    ),
  )
}

// ---------------------------------------------------------------- 提交守卫（同步加锁）
const { submitting: writeSubmitting, run: runWrite } = useSubmitGuard()

// ---------------------------------------------------------------- BOM 写入
const bomDialogVisible = ref(false)
const bomForm = reactive<{
  id: string | null
  materialCode: string
  level: number
  qty: string
  unit: string
}>({
  id: null,
  materialCode: '',
  level: 1,
  qty: '1.00',
  unit: '',
})

const canWriteBom = computed(() => auth.can('boms:write'))
const canWriteSafetyStock = computed(() => auth.can('materials:safety-stock:write'))
const canCreateBatch = computed(() => auth.can('material-batches:create'))

function openCreateBom(): void {
  bomForm.id = null
  bomForm.materialCode = ''
  bomForm.level = 1
  bomForm.qty = '1.00'
  bomForm.unit = ''
  bomDialogVisible.value = true
}

function openEditBom(row: Bom): void {
  bomForm.id = row.id
  bomForm.materialCode = row.materialCode
  bomForm.level = row.level
  bomForm.qty = row.qty
  bomForm.unit = row.unit ?? ''
  bomDialogVisible.value = true
}

function submitBom(): void {
  const code = productCode.value.trim()
  if (!code) {
    showWarning('请先填写产品编码')
    return
  }
  const qty = bomForm.qty.trim()
  const level = Number(bomForm.level)
  if (!/^\d+(\.\d{1,4})?$/.test(qty) || Number(qty) <= 0) {
    showWarning('qty 必须为大于 0 的十进制字符串（如 2.00）')
    return
  }
  if (!Number.isInteger(level) || level < 1) {
    showWarning('level 必须为 ≥ 1 的整数')
    return
  }
  const payload: CreateBomPayload = {
    materialCode: bomForm.materialCode.trim(),
    level,
    qty,
    unit: bomForm.unit.trim() || undefined,
  }
  const id = bomForm.id
  void runWrite(async () => {
    try {
      if (id === null) {
        await bomsService.create(code, payload)
        showInfo('BOM 行已新增')
      } else {
        await bomsService.update(id, payload)
        showInfo('BOM 行已更新')
      }
      bomDialogVisible.value = false
      fetchBoms()
    } catch (error) {
      showWriteError(error)
    }
  })
}

function removeBom(row: Bom): void {
  void ElMessageBox.confirm(`确认删除 BOM 行 ${row.materialCode}？`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(() =>
      runWrite(async () => {
        try {
          await bomsService.remove(row.id)
          showInfo('BOM 行已删除')
          fetchBoms()
        } catch (error) {
          showWriteError(error)
        }
      }),
    )
    .catch(() => undefined)
}

// ---------------------------------------------------------------- 物料安全库存
const stockDialogVisible = ref(false)
const stockRow = ref<Material | null>(null)
const stockValue = ref(0)

function openStockDialog(row: Material): void {
  stockRow.value = row
  stockValue.value = row.safetyStock
  stockDialogVisible.value = true
}

function submitSafetyStock(): void {
  const row = stockRow.value
  if (!row) return
  void runWrite(async () => {
    try {
      await materialsService.updateSafetyStock(row.code, stockValue.value)
      showInfo(`已更新 ${row.code} 安全库存`)
      stockDialogVisible.value = false
      fetchMaterials()
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- 批次入库
const batchDialogVisible = ref(false)
const batchForm = reactive<{
  batchNo: string
  materialCode: string
  qty: number
  inboundAt: string
  supplier: string
}>({
  batchNo: '',
  materialCode: '',
  qty: 0,
  inboundAt: '',
  supplier: '',
})

function openCreateBatch(): void {
  batchForm.batchNo = ''
  batchForm.materialCode = ''
  batchForm.qty = 0
  batchForm.inboundAt = ''
  batchForm.supplier = ''
  batchDialogVisible.value = true
}

function submitBatch(): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batchForm.inboundAt.trim())) {
    showWarning('入库日期必须为 YYYY-MM-DD')
    return
  }
  if (!Number.isInteger(batchForm.qty) || batchForm.qty <= 0) {
    showWarning('入库数量必须为正整数')
    return
  }
  const payload: CreateMaterialBatchPayload = {
    batchNo: batchForm.batchNo.trim(),
    materialCode: batchForm.materialCode.trim(),
    qty: batchForm.qty,
    inboundAt: batchForm.inboundAt.trim(),
    supplier: batchForm.supplier.trim() || undefined,
  }
  void runWrite(async () => {
    try {
      await materialBatchesService.create(payload)
      showInfo('批次已登记（数量仅表示入库数量，不代表可用库存）')
      batchDialogVisible.value = false
      fetchBatches()
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- 批次反查 SN
const reverseBatch = ref<MaterialBatch | null>(null)

function openReverseSn(batch: MaterialBatch): void {
  reverseBatch.value = batch
  void reverseTask.run((signal) =>
    materialBatchesService.listSnTraces(batch.id, { page: 1, pageSize: 50 }, signal),
  )
}

function refreshAll(): void {
  fetchMaterials()
  fetchBoms()
  fetchBatches()
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h2 class="page__title">物料管理</h2>
        <p class="page__summary">
          BOM qty 为精确十进制字符串；level 不代表父子关系。批次数量仅表示入库数量，
          <strong>不等于可用库存</strong>；本页不出库、不扣库存、不自动算料。
        </p>
      </div>
      <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
    </header>

    <el-tabs>
      <!-- ---------------------------------------------------- 产品 BOM -->
      <el-tab-pane label="产品 BOM" name="boms">
        <div class="toolbar">
          <el-input v-model="productCode" placeholder="产品编码，如 JC-PLC-2001" style="width: 260px" clearable />
          <el-button type="primary" :icon="Search" @click="fetchBoms">查询</el-button>
          <el-button v-if="canWriteBom" type="success" :icon="Plus" @click="openCreateBom">新增 BOM 行</el-button>
        </div>

        <LoadingState v-if="bomsTask.loading.value" />
        <ErrorState
          v-else-if="bomsTask.error.value"
          :error="bomsTask.error.value"
          retryable
          @retry="fetchBoms"
        />
        <EmptyState
          v-else-if="!bomsTask.data.value || bomsTask.data.value.list.length === 0"
          description="该产品暂无 BOM 行，或产品编码不存在。"
        />
        <el-table v-else :data="bomsTask.data.value.list" border size="small">
          <el-table-column prop="id" label="ID" width="90" />
          <el-table-column prop="productCode" label="产品编码" min-width="140" />
          <el-table-column prop="level" label="层级 level" width="110">
            <template #default="{ row }">{{ row.level }}</template>
          </el-table-column>
          <el-table-column prop="materialCode" label="物料编码" min-width="140" />
          <el-table-column prop="qty" label="用量 qty（十进制字符串）" min-width="170" />
          <el-table-column prop="unit" label="单位" width="90" />
          <el-table-column label="数据来源" width="130">
            <template #default="{ row }"><DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" /></template>
          </el-table-column>
          <el-table-column v-if="canWriteBom" label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditBom(row)">修改</el-button>
              <el-button link type="danger" @click="removeBom(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <p class="note">
          已确认订单 / 工单关联的 BOM 修改与删除会被服务端按契约拒绝（错误码 30004）。
        </p>
      </el-tab-pane>

      <!-- ---------------------------------------------------- 物料 -->
      <el-tab-pane label="物料主数据" name="materials">
        <div class="toolbar">
          <el-input v-model="materialQuery.keyword" placeholder="编码 / 名称关键词" style="width: 220px" clearable />
          <el-input v-model="materialQuery.category" placeholder="分类" style="width: 160px" clearable />
          <el-button type="primary" :icon="Search" @click="fetchMaterials">查询</el-button>
        </div>

        <LoadingState v-if="materialsTask.loading.value" />
        <ErrorState
          v-else-if="materialsTask.error.value"
          :error="materialsTask.error.value"
          retryable
          @retry="fetchMaterials"
        />
        <EmptyState v-else-if="!materialsTask.data.value || materialsTask.data.value.list.length === 0" description="暂无物料主数据。" />
        <el-table v-else :data="materialsTask.data.value.list" border size="small">
          <el-table-column prop="code" label="编码" min-width="120" />
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column prop="spec" label="规格" min-width="120" show-overflow-tooltip />
          <el-table-column prop="category" label="分类" width="110" />
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column prop="safetyStock" label="安全库存" width="110" />
          <el-table-column prop="supplier" label="供应商" min-width="120" show-overflow-tooltip />
          <el-table-column label="数据来源" width="130">
            <template #default="{ row }"><DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" /></template>
          </el-table-column>
          <el-table-column v-if="canWriteSafetyStock" label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openStockDialog(row)">改安全库存</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ---------------------------------------------------- 批次 -->
      <el-tab-pane label="物料批次" name="batches">
        <div class="toolbar">
          <el-input v-model="batchQuery.materialCode" placeholder="物料编码" style="width: 200px" clearable />
          <el-input v-model="batchQuery.batchNo" placeholder="批次号" style="width: 200px" clearable />
          <el-button type="primary" :icon="Search" @click="fetchBatches">查询</el-button>
          <el-button v-if="canCreateBatch" type="success" :icon="Plus" @click="openCreateBatch">批次入库登记</el-button>
        </div>

        <LoadingState v-if="batchesTask.loading.value" />
        <ErrorState
          v-else-if="batchesTask.error.value"
          :error="batchesTask.error.value"
          retryable
          @retry="fetchBatches"
        />
        <EmptyState v-else-if="!batchesTask.data.value || batchesTask.data.value.list.length === 0" description="暂无物料批次。" />
        <el-table v-else :data="batchesTask.data.value.list" border size="small">
          <el-table-column prop="batchNo" label="批次号" min-width="150" />
          <el-table-column prop="materialCode" label="物料编码" min-width="120" />
          <el-table-column prop="qty" label="入库数量（非可用库存）" min-width="170" />
          <el-table-column prop="inboundAt" label="入库日期" width="130" />
          <el-table-column prop="supplier" label="供应商" min-width="120" show-overflow-tooltip />
          <el-table-column label="数据来源" width="130">
            <template #default="{ row }"><DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" /></template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openReverseSn(row)">反查 SN</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- BOM 编辑对话框 -->
    <el-dialog v-model="bomDialogVisible" :title="bomForm.id === null ? '新增 BOM 行' : '修改 BOM 行'" width="460px">
      <el-form label-width="96px">
        <el-form-item label="物料编码">
          <el-input v-model="bomForm.materialCode" :disabled="bomForm.id !== null" placeholder="必须真实存在" />
        </el-form-item>
        <el-form-item label="level">
          <el-input-number v-model="bomForm.level" :min="1" :step="1" />
        </el-form-item>
        <el-form-item label="qty">
          <el-input v-model="bomForm.qty" placeholder="十进制字符串，如 2.00" />
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="bomForm.unit" placeholder="可留空" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bomDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="writeSubmitting" @click="submitBom">保存</el-button>
      </template>
    </el-dialog>

    <!-- 安全库存对话框 -->
    <el-dialog v-model="stockDialogVisible" title="修改安全库存" width="420px">
      <template v-if="stockRow">
        <el-form label-width="96px">
          <el-form-item label="物料编码">
            <span>{{ stockRow.code }}（{{ stockRow.name }}）</span>
          </el-form-item>
          <el-form-item label="安全库存">
            <el-input-number v-model="stockValue" :min="0" :step="1" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="stockDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="writeSubmitting" @click="submitSafetyStock">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批次入库对话框 -->
    <el-dialog v-model="batchDialogVisible" title="批次入库登记" width="460px">
      <el-form label-width="96px">
        <el-form-item label="批次号">
          <el-input v-model="batchForm.batchNo" placeholder="唯一，不可重复" />
        </el-form-item>
        <el-form-item label="物料编码">
          <el-input v-model="batchForm.materialCode" placeholder="必须真实存在" />
        </el-form-item>
        <el-form-item label="入库数量">
          <el-input-number v-model="batchForm.qty" :min="1" :step="1" />
        </el-form-item>
        <el-form-item label="入库日期">
          <el-date-picker
            v-model="batchForm.inboundAt"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
          />
        </el-form-item>
        <el-form-item label="供应商">
          <el-input v-model="batchForm.supplier" placeholder="可留空" />
        </el-form-item>
      </el-form>
      <p class="note">批次数量仅表示入库数量，不是可用库存。</p>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="writeSubmitting" @click="submitBatch">登记</el-button>
      </template>
    </el-dialog>

    <!-- 批次反查 SN -->
    <el-dialog v-model="reverseBatch" title="批次绑定的 SN" width="640px">
      <template v-if="reverseBatch">
        <p class="note">批次 {{ reverseBatch.batchNo }}（物料 {{ reverseBatch.materialCode }}）</p>
        <LoadingState v-if="reverseTask.loading.value" />
        <ErrorState
          v-else-if="reverseTask.error.value"
          :error="reverseTask.error.value"
          retryable
          @retry="reverseBatch && openReverseSn(reverseBatch)"
        />
        <EmptyState
          v-else-if="!reverseTask.data.value || reverseTask.data.value.list.length === 0"
          description="该批次暂无绑定的 SN。"
        />
        <el-table v-else :data="reverseTask.data.value.list" border size="small">
          <el-table-column prop="sn" label="SN" min-width="160" />
          <el-table-column prop="workOrderId" label="工单 ID" min-width="120" />
        </el-table>
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

.note {
  margin: var(--mes-space-2) 0 0;
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
}
</style>
