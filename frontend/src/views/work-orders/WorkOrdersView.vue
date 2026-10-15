<script setup lang="ts">
/**
 * B2 工单与工序任务页面（契约 §6.3）。
 *
 * 已批准范围内提供的操作：
 * - 工单计划编辑（仅「待启动」，DATE）；
 * - 工单状态流转：`待启动 → 在产`、`在产 → 完工`（契约 §6.3「需求确定主线」）。
 *
 * ⚠️ 不提供可执行入口的操作（未批准 / 未实现）：
 * - 工单「暂停 / 恢复 / 关闭」—— Q2 未决，界面不渲染按钮，后端返回 30006；
 * - **任务分配**（设备 / 操作员 / 产线）—— Q2 未决，后端返回 30006；
 * - **任务状态迁移** —— 与分配条件同属 Q2，后端返回 30006；
 * - **任务计划编辑** —— 同属该接口，整体待 Q2；
 * - 报工、质检、返工、冲销、APS 排产、随意创建工单或任务——均不在本轮范围。
 *
 * 用户裁决（2026-10-10）：「Q2 未确认前，任务分配及相关状态迁移不启用写入，
 * 前端不提供可执行按钮，不能仅靠存在性校验开放操作。」
 */
import { Edit, Refresh, Search, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useDetailFlow } from '@/composables/useDetailFlow'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { useViewport } from '@/composables/useViewport'
import { productsService } from '@/services/products'
import { workOrdersService } from '@/services/work-orders'
import { showWriteError } from '@/services/write-feedback'
import { useAuthStore } from '@/stores/auth'
import type { PageResult } from '@/types/api'
import type { Product } from '@/types/product'
import {
  TASK_STATUS_TAG,
  WORK_ORDER_STATUS,
  WORK_ORDER_STATUS_TAG,
  WORK_ORDER_STATUS_VALUES,
  WORK_ORDER_TRANSITIONS,
  type Task,
  type UpdateWorkOrderPayload,
  type WorkOrder,
} from '@/types/work-order'
import { formatCount, formatId, formatNullableText } from '@/utils/format'

const authStore = useAuthStore()
const { isNarrow } = useViewport()

/** 契约 §5.2：计划修改与状态流转仅 admin / manager（后端仍会鉴权） */
const canWrite = computed(() => authStore.can('work-orders:write') || authStore.can('tasks:write'))

const drawerSize = computed(() => (isNarrow.value ? '100%' : '760px'))

// ---------------------------------------------------------------- 列表

const listTask = useAsyncTask<PageResult<WorkOrder>>()

const filters = reactive({
  status: '',
  productCode: '',
  keyword: '',
  saleOrderId: '',
  prodLine: '',
  workshop: '',
})

const page = ref(1)
const pageSize = ref(20)

function loadWorkOrders(): void {
  void listTask.run((signal) =>
    workOrdersService.list(
      {
        page: page.value,
        pageSize: pageSize.value,
        status: filters.status || undefined,
        productCode: filters.productCode || undefined,
        keyword: filters.keyword || undefined,
        saleOrderId: filters.saleOrderId.trim() || undefined,
        prodLine: filters.prodLine || undefined,
        workshop: filters.workshop || undefined,
      },
      signal,
    ),
  )
}

function onSearch(): void {
  page.value = 1
  loadWorkOrders()
}

function onReset(): void {
  filters.status = ''
  filters.productCode = ''
  filters.keyword = ''
  filters.saleOrderId = ''
  filters.prodLine = ''
  filters.workshop = ''
  page.value = 1
  loadWorkOrders()
}

const unauthorized = computed(() => listTask.error.value?.kind === 'unauthenticated')

const productsTask = useAsyncTask<PageResult<Product>>()
const productOptions = computed(() => productsTask.data.value?.list ?? [])

// ---------------------------------------------------------------- 详情

const drawer = reactive({ visible: false, workOrder: null as WorkOrder | null })

/**
 * 详情流程用 `useDetailFlow` 统一编排（工单详情 + 工序任务列表）。
 *
 * 修复记录（2026-10-10 S5 审查 P2「旧详情流程覆盖新对象的关联数据」）：
 * 初版把两者拆成两个独立任务，先点 A 再点 B 时，A 的详情请求虽被取消，
 * 但其续行仍会启动 A 的任务列表查询，最终呈现「B 的工单 + A 的工序任务」。
 * `useDetailFlow` 用轮次标识把整条链路绑在一起。
 */
const detailFlow = useDetailFlow<WorkOrder, PageResult<Task>>({
  fetchDetail: (id, signal) => workOrdersService.detail(id, signal),
  fetchRelated: (id, signal) => workOrdersService.tasks(id, { page: 1, pageSize: 100 }, signal),
})

const detailWorkOrder = computed(() => detailFlow.detail.value ?? drawer.workOrder)
const tasks = computed(() => detailFlow.related.value?.list ?? [])

function loadDetail(id: string): void {
  void detailFlow.run(id)
}

function openDetail(row: WorkOrder): void {
  drawer.workOrder = row
  drawer.visible = true
  loadDetail(row.id)
}

function closeDrawer(): void {
  drawer.visible = false
  drawer.workOrder = null
  detailFlow.reset()
}

// ---------------------------------------------------------------- 工单计划

const planDialog = reactive({ visible: false, id: '', code: '' })
const planForm = reactive({ planStart: null as string | null, planEnd: null as string | null })
let planOriginal = { planStart: null as string | null, planEnd: null as string | null }

/** 提交守卫：锁在任何 await 之前同步获取（见 composables/useSubmitGuard.ts） */
const { submitting: planSubmitting, run: runPlanSubmit } = useSubmitGuard()

function openPlan(row: WorkOrder): void {
  planDialog.id = row.id
  planDialog.code = row.code
  planForm.planStart = row.planStart
  planForm.planEnd = row.planEnd
  planOriginal = { planStart: row.planStart, planEnd: row.planEnd }
  planDialog.visible = true
}

function submitPlan(): void {
  void runPlanSubmit(async () => {
    const nextStart = planForm.planStart ?? null
    const nextEnd = planForm.planEnd ?? null
    const payload: UpdateWorkOrderPayload = {}
    if (nextStart !== planOriginal.planStart) payload.planStart = nextStart
    if (nextEnd !== planOriginal.planEnd) payload.planEnd = nextEnd

    if (payload.planStart === undefined && payload.planEnd === undefined) {
      ElMessage({ type: 'info', message: '计划没有变化。', duration: 2500 })
      return
    }
    if (nextStart !== null && nextEnd !== null && nextStart > nextEnd) {
      ElMessage({ type: 'warning', message: '计划开始日期不得晚于计划结束日期。', duration: 3000 })
      return
    }

    try {
      await workOrdersService.updatePlan(planDialog.id, payload)
      ElMessage({ type: 'success', message: `工单 ${planDialog.code} 计划已保存。`, duration: 3000 })
      planDialog.visible = false
      loadWorkOrders()
      loadDetail(planDialog.id)
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- 状态流转（仅主线）

const transitioning = ref('')

function transitionTargets(status: string): readonly string[] {
  return WORK_ORDER_TRANSITIONS[status] ?? []
}

async function transitionWorkOrder(row: WorkOrder, targetStatus: string): Promise<void> {
  const guard = `wo:${row.id}:${targetStatus}`
  if (transitioning.value !== '') return
  transitioning.value = guard
  try {
    await workOrdersService.transitionWorkOrder(row.id, {
      expectedStatus: row.status,
      targetStatus,
    })
    ElMessage({ type: 'success', message: `工单 ${row.code} 已流转为「${targetStatus}」。`, duration: 3000 })
    loadWorkOrders()
    loadDetail(row.id)
  } catch (error) {
    showWriteError(error)
  } finally {
    transitioning.value = ''
  }
}

// ---------------------------------------------------------------- 任务分配 / 任务状态迁移：Q2 未决，不提供入口

/**
 * 这里**故意不实现**任务分配、任务计划与任务状态迁移的调用逻辑。
 *
 * 用户裁决（2026-10-10）：「Q2 未确认前，任务分配及相关状态迁移不启用写入，
 * 前端不提供可执行按钮，不能仅靠存在性校验开放操作。」
 *
 * 后端 `PATCH /tasks/{id}` 与 `POST /tasks/{id}/state-transitions` 一律返回 `30006`，
 * 因此界面上也不渲染任何可执行按钮；待 Q2 批准后再一并接入。
 */

const route = useRoute()

function syncFromRoute(): void {
  filters.productCode = typeof route.query.productCode === 'string' ? route.query.productCode : ''
  filters.status = typeof route.query.status === 'string' ? route.query.status : ''
  filters.saleOrderId = typeof route.query.saleOrderId === 'string' ? route.query.saleOrderId : ''
  filters.keyword = typeof route.query.keyword === 'string' ? route.query.keyword : ''
  filters.prodLine = typeof route.query.prodLine === 'string' ? route.query.prodLine : ''
  filters.workshop = typeof route.query.workshop === 'string' ? route.query.workshop : ''
  page.value = 1
}


onMounted(() => {
  syncFromRoute()
  void productsTask.run((signal) => productsService.list({ page: 1, pageSize: 100 }, signal))
  loadWorkOrders()
})

watch(
  () => route.query,
  () => {
    syncFromRoute()
    loadWorkOrders()
  },
)
</script>

<template>
  <div class="work-orders">
    <el-alert
      v-if="unauthorized"
      class="work-orders__notice"
      type="warning"
      :closable="false"
      show-icon
      title="后端鉴权尚未接入，业务接口当前不可用"
      description="业务操作需要真实 JWT 登录；当前页面按服务端 RBAC 返回结果展示可用操作。"
    />

    <el-alert
      class="work-orders__notice"
      type="info"
      :closable="false"
      show-icon
      title="本版仅开放工单计划编辑与工单状态主线：待启动 → 在产 → 完工"
      description="工单「暂停 / 恢复 / 关闭」、工序顺序前置条件、完工阈值与自动触发点、设备与操作员分配条件均待 Q2 决策确认，因此界面不提供对应入口，后端亦返回 30006。任务分配、任务计划与任务状态迁移同属 Q2，本版一律不启用写入。"
    />

    <section class="mes-card">
      <el-form class="work-orders__toolbar" inline @submit.prevent>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 130px">
            <el-option
              v-for="item in WORK_ORDER_STATUS_VALUES"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="产品">
          <el-select
            v-model="filters.productCode"
            placeholder="全部"
            clearable
            filterable
            style="width: 220px"
          >
            <el-option
              v-for="item in productOptions"
              :key="item.code"
              :label="`${item.code} · ${item.name}`"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="工单编号">
          <el-input
            v-model="filters.keyword"
            placeholder="按工单编号模糊查询"
            clearable
            style="width: 190px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="订单 ID">
          <el-input
            v-model="filters.saleOrderId"
            placeholder="按订单 ID 精确查询"
            clearable
            style="width: 170px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item v-if="filters.prodLine" label="产线">
          <el-tag closable @close="filters.prodLine = ''; onSearch()">{{ filters.prodLine }}</el-tag>
        </el-form-item>
        <el-form-item v-if="filters.workshop" label="车间">
          <el-tag closable @close="filters.workshop = ''; onSearch()">{{ filters.workshop }}</el-tag>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
          <el-button :icon="Refresh" @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>

      <LoadingState v-if="listTask.loading.value" />
      <ErrorState
        v-else-if="listTask.error.value"
        :error="listTask.error.value"
        retryable
        @retry="loadWorkOrders"
      />
      <EmptyState
        v-else-if="(listTask.data.value?.list.length ?? 0) === 0"
        text="没有符合条件的工单"
        description="工单只能由订单确认生成（本版不提供随意创建工单接口）。"
      />
      <template v-else>
        <div class="table-scroll">
          <el-table :data="listTask.data.value?.list ?? []" size="small" border stripe>
            <el-table-column label="工单编号" prop="code" min-width="170" />
            <el-table-column label="订单 ID" width="100">
              <template #default="{ row }">{{ formatId(row.saleOrderId) }}</template>
            </el-table-column>
            <el-table-column label="产品编号" prop="productCode" min-width="140" />
            <el-table-column label="计划数量" prop="qty" width="100" align="right" />
            <el-table-column label="完工数量" width="100" align="right">
              <template #default="{ row }">{{ formatCount(row.doneQty) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="WORK_ORDER_STATUS_TAG[row.status] ?? 'info'">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="计划区间" min-width="190">
              <template #default="{ row }">
                {{ formatNullableText(row.planStart) }} ~ {{ formatNullableText(row.planEnd) }}
              </template>
            </el-table-column>
            <el-table-column label="数据来源" width="110">
              <template #default="{ row }">
                <DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="230" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :icon="View" @click="openDetail(row)">详情</el-button>
                <template v-if="canWrite">
                  <el-button
                    v-if="row.status === WORK_ORDER_STATUS.PENDING"
                    link
                    type="primary"
                    :icon="Edit"
                    @click="openPlan(row)"
                  >
                    计划
                  </el-button>
                  <el-button
                    v-for="target in transitionTargets(row.status)"
                    :key="target"
                    link
                    type="success"
                    :loading="transitioning === `wo:${row.id}:${target}`"
                    :disabled="transitioning !== ''"
                    @click="transitionWorkOrder(row, target)"
                  >
                    {{ target }}
                  </el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="work-orders__pager">
          <el-pagination
            :current-page="page"
            :page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="listTask.data.value?.total ?? 0"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="(next: number) => { page = next; loadWorkOrders() }"
            @size-change="(next: number) => { pageSize = next; page = 1; loadWorkOrders() }"
          />
        </div>
      </template>
    </section>

    <!-- 详情 -->
    <el-drawer
      v-model="drawer.visible"
      title="工单详情"
      :size="drawerSize"
      :destroy-on-close="false"
      @closed="closeDrawer"
    >
      <LoadingState v-if="detailFlow.loading.value" />
      <ErrorState v-else-if="detailFlow.error.value" :error="detailFlow.error.value" />
      <template v-else-if="detailWorkOrder">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="工单 ID">{{ formatId(detailWorkOrder.id) }}</el-descriptions-item>
          <el-descriptions-item label="工单编号">{{ detailWorkOrder.code }}</el-descriptions-item>
          <el-descriptions-item label="来源订单">
            {{ formatId(detailWorkOrder.saleOrderId) }}
          </el-descriptions-item>
          <el-descriptions-item label="产品编号">{{ detailWorkOrder.productCode }}</el-descriptions-item>
          <el-descriptions-item label="计划数量">{{ detailWorkOrder.qty }}</el-descriptions-item>
          <el-descriptions-item label="完工数量">
            {{ formatCount(detailWorkOrder.doneQty) }}
            <span class="work-orders__muted">（口径：末道工序累计良品，属 B3，本轮未实现累计）</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="WORK_ORDER_STATUS_TAG[detailWorkOrder.status] ?? 'info'">
              {{ detailWorkOrder.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="计划区间">
            {{ formatNullableText(detailWorkOrder.planStart) }} ~
            {{ formatNullableText(detailWorkOrder.planEnd) }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatNullableText(detailWorkOrder.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="数据来源">
            <DataSourceTag
              :data-source="detailWorkOrder.dataSource"
              :data-label="detailWorkOrder.dataLabel"
            />
          </el-descriptions-item>
        </el-descriptions>

        <div class="work-orders__actions">
          <template v-if="canWrite">
            <el-button
              v-if="detailWorkOrder.status === WORK_ORDER_STATUS.PENDING"
              size="small"
              :icon="Edit"
              @click="openPlan(detailWorkOrder)"
            >
              修改计划
            </el-button>
            <el-button
              v-for="target in transitionTargets(detailWorkOrder.status)"
              :key="target"
              size="small"
              type="primary"
              plain
              :loading="transitioning === `wo:${detailWorkOrder.id}:${target}`"
              :disabled="transitioning !== ''"
              @click="transitionWorkOrder(detailWorkOrder, target)"
            >
              流转为「{{ target }}」
            </el-button>
          </template>
          <span class="work-orders__muted">
            暂停 / 恢复 / 关闭待 Q2 确认，本版不提供入口。
          </span>
        </div>

        <h4 class="work-orders__subtitle">工序任务</h4>
        <LoadingState v-if="detailFlow.loading.value" min-height="80px" />
        <ErrorState v-else-if="detailFlow.error.value" :error="detailFlow.error.value" min-height="80px" />
        <EmptyState v-else-if="tasks.length === 0" text="该工单没有工序任务" min-height="80px" />
        <div v-else class="table-scroll">
          <el-table :data="tasks" size="small" border>
            <el-table-column label="工序序号" prop="seq" width="90" align="right" />
            <el-table-column label="工序名称" prop="stepName" min-width="130" />
            <el-table-column label="车间" width="110">
              <template #default="{ row }">{{ formatNullableText(row.workshop) }}</template>
            </el-table-column>
            <el-table-column label="产线" width="110">
              <template #default="{ row }">{{ formatNullableText(row.prodLine) }}</template>
            </el-table-column>
            <el-table-column label="计划数量" prop="planQty" width="100" align="right" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="TASK_STATUS_TAG[row.status] ?? 'info'">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="计划时间" min-width="230">
              <template #default="{ row }">
                {{ formatNullableText(row.planStart) }} ~ {{ formatNullableText(row.planEnd) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
        <p class="work-orders__muted work-orders__muted--block">
          任务分配（设备 / 操作员 / 产线）、任务计划与任务状态迁移均待 Q2 决策确认，
          <strong>本版不提供任何可执行入口</strong>，后端对相应写请求一律返回 30006。
        </p>
      </template>
      <EmptyState v-else text="未选择工单" />
    </el-drawer>

    <!-- 工单计划 -->
    <el-dialog
      v-model="planDialog.visible"
      :title="`修改工单计划 · ${planDialog.code}`"
      width="460px"
      :close-on-click-modal="false"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="计划开始">
          <el-date-picker
            v-model="planForm.planStart"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="留空表示未设置"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker
            v-model="planForm.planEnd"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="留空表示未设置"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <p class="work-orders__muted">
        工单计划为 DATE 口径（契约 §6.8 日计划分摊使用），仅「待启动」工单可修改。
      </p>
      <template #footer>
        <el-button :disabled="planSubmitting" @click="planDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="planSubmitting" @click="submitPlan">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.work-orders {
  display: flex;
  flex-direction: column;
  gap: var(--mes-space-3);
}

.work-orders__notice {
  margin-bottom: var(--mes-space-1);
}

.work-orders__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mes-space-1);
  margin-bottom: var(--mes-space-3);
}

.work-orders__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--mes-space-3);
}

.work-orders__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--mes-space-2);
  margin-top: var(--mes-space-3);
}

.work-orders__subtitle {
  margin: var(--mes-space-4) 0 var(--mes-space-2);
  font-size: var(--mes-font-size-md);
}

.work-orders__muted {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-xs);
  line-height: 1.6;
}

.work-orders__muted--block {
  margin: var(--mes-space-2) 0 0;
}

@media (max-width: 768px) {
  .work-orders__toolbar :deep(.el-form-item) {
    margin-right: 0;
    width: 100%;
  }
}
</style>
