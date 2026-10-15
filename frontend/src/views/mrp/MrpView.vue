<script setup lang="ts">
/**
 * B12 MRP-lite 页面 —— 契约 §6.10（受限）。
 *
 * 边界（任务书 §B12，页面必须如实展示）：
 * - 只计算并展示**平面 BOM 毛需求**（订单数量 × BOM 用量），服务端以十进制字符串返回；
 * - availableQty / shortageQty / purchaseSuggestionQty 服务端恒为 null ——
 *   页面显示「不可用」并附限制说明，**不把 null 变成 0，不自行推导缺料**；
 * - inboundQty 只是累计入库数量，不等于可用库存；
 * - 缺 BOM（30005）与订单不存在（30001）按服务端业务码如实提示；
 * - 订单选择最多 100 个，选择即去重（按 ID）。
 */
import { Goods, Refresh } from '@element-plus/icons-vue'
import { computed, onMounted, ref } from 'vue'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { showApiError, showWarning } from '@/services/notify'
import { materialRequirementsService } from '@/services/material-requirements'
import { ordersService } from '@/services/orders'
import { ERROR_CODES } from '@/types/api'
import type { PageResult } from '@/types/api'
import type { Order } from '@/types/order'
import type { MaterialRequirementCalculationResponse } from '@/types/material-requirement'

/** 单次计算的订单数量上限（与后端 DTO 一致） */
const MAX_SELECTED = 100

const ordersTask = useAsyncTask<PageResult<Order>>()
const calcTask = useAsyncTask<MaterialRequirementCalculationResponse>()
const { submitting, run } = useSubmitGuard()

const selectedIds = ref<string[]>([])

const orderRows = computed<Order[]>(() => ordersTask.data.value?.list ?? [])
const canSubmit = computed(() => selectedIds.value.length > 0 && selectedIds.value.length <= MAX_SELECTED)

function fetchOrders(): void {
  void ordersTask.run((signal) =>
    ordersService.list({ page: 1, pageSize: MAX_SELECTED }, signal),
  )
}

onMounted(fetchOrders)

function handleSelectionChange(rows: Order[]): void {
  // 表格按 ID 去重（el-table 的 reserve-selection 已按 row-key 去重，这里兜底）
  selectedIds.value = [...new Set(rows.map((row) => row.id))].slice(0, MAX_SELECTED)
}

function calculate(): void {
  if (!canSubmit.value) {
    showWarning(`请选择 1 ~ ${MAX_SELECTED} 个订单`)
    return
  }
  void run(async () => {
    try {
      await calcTask.run((signal) =>
        materialRequirementsService.calculate({ orderIds: selectedIds.value }, signal),
      )
    } catch (error) {
      showApiError(error)
    }
  })
}

/** 缺 BOM（30005）等业务错误的额外上下文提示 */
function calcErrorMessage(): string | null {
  const error = calcTask.error.value
  if (!error) return null
  if (error.code === ERROR_CODES.MISSING_PREREQUISITE) {
    return '有订单的产品缺少 BOM 明细：缺 BOM 不等于「无需物料」，请先维护 BOM。'
  }
  if (error.code === ERROR_CODES.RESOURCE_NOT_FOUND) {
    return '所选订单中有一部分已不存在，请刷新订单列表后重新选择。'
  }
  return null
}
</script>

<template>
  <div class="page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>MRP-lite 毛需求计算（B12 · 受限）</span>
          <DataSourceTag data-source="demo" data-label="演示数据" />
        </div>
      </template>

      <div class="toolbar">
        <el-button type="primary" :icon="Goods" :loading="submitting" :disabled="!canSubmit" @click="calculate">
          计算毛需求（已选 {{ selectedIds.length }} 单）
        </el-button>
        <el-button :icon="Refresh" @click="fetchOrders">刷新订单列表</el-button>
      </div>

      <LoadingState v-if="ordersTask.loading.value && orderRows.length === 0" />
      <ErrorState v-else-if="ordersTask.error.value" :error="ordersTask.error.value" @retry="fetchOrders" />
      <EmptyState v-else-if="orderRows.length === 0" description="当前没有可计算的订单" />
      <el-table
        v-else
        :data="orderRows"
        row-key="id"
        size="small"
        class="table"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="42" :reserve-selection="true" />
        <el-table-column prop="code" label="订单编号" min-width="160" />
        <el-table-column prop="productCode" label="产品" min-width="140" />
        <el-table-column prop="qty" label="数量" width="90" />
        <el-table-column prop="status" label="状态" width="90" />
        <el-table-column prop="dueDate" label="交期" width="130" />
      </el-table>
    </el-card>

    <el-card class="block">
      <template #header>
        <div class="card-header">
          <span>毛需求结果（平面 BOM：订单数量 × BOM 用量）</span>
          <DataSourceTag v-if="calcTask.data.value" data-source="demo" data-label="演示数据" />
        </div>
      </template>

      <LoadingState v-if="calcTask.loading.value" />
      <ErrorState v-else-if="calcTask.error.value" :error="calcTask.error.value" @retry="calculate" />
      <el-alert
        v-if="calcErrorMessage()"
        type="warning"
        :closable="false"
        :title="calcErrorMessage() ?? ''"
        class="table"
      />
      <EmptyState
        v-else-if="!calcTask.data.value"
        description="选择订单后点击「计算毛需求」；本页只计算毛需求，不生成任何采购单"
      />
      <template v-else-if="calcTask.data.value">
        <el-table :data="calcTask.data.value.items" size="small" class="table">
          <el-table-column prop="materialCode" label="物料编号" min-width="150" />
          <el-table-column label="毛需求" min-width="130">
            <template #default="{ row }">{{ row.grossRequiredQty }}</template>
          </el-table-column>
          <el-table-column label="累计入库（≠可用库存）" min-width="150">
            <template #default="{ row }">{{ row.inboundQty }}</template>
          </el-table-column>
          <el-table-column label="可用库存" min-width="110">
            <template #default><span class="null-cell">不可用</span></template>
          </el-table-column>
          <el-table-column label="净缺口" min-width="110">
            <template #default><span class="null-cell">不可用</span></template>
          </el-table-column>
          <el-table-column label="采购建议" min-width="110">
            <template #default><span class="null-cell">不可用</span></template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>

    <el-card class="block">
      <template #header><span>限制说明（为什么没有净缺口与采购量）</span></template>
      <ul class="limitations">
        <li v-for="item in calcTask.data.value?.limitations ?? [
          '现有表没有出库、占用、调整与采购在途流水，不能计算真实净缺口与采购量。',
          '缺 BOM 的订单会整体返回 30005，不会被当作「无需物料」跳过。',
          '结果不持久化采购单，也不生成任何采购写入入口。',
        ]" :key="item">
          {{ item }}
        </li>
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

.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.table {
  margin-top: 0;
}

.null-cell {
  color: var(--el-text-color-placeholder, #a8abb2);
}

.limitations {
  margin: 0;
  padding-left: 18px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
  line-height: 1.8;
}
</style>
