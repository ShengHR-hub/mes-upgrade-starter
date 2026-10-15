<script setup lang="ts">
/**
 * B1 生产订单页面（契约 §6.2）。
 *
 * 接入方式：只在 `config/modules.ts` 为 `orders` 登记 `component`，
 * 路由 / 菜单 / 面包屑 / 页面标题 / 权限元数据全部自动跟随（S4 交接文档 §7.1）。
 *
 * 交互约束（S5 任务书 §五）：
 * - 提交中阻止重复点击与重复回车（`submitting` 守卫 + 按钮 loading）；
 * - 写请求不自动重试（统一客户端已保证）；超时/断网提示「结果未确认，请查询核对」；
 * - 成功提示只来自真实成功响应；
 * - 确认后重新拉取订单与关联工单，不靠本地推测状态；
 * - 403 → 无权限提示；401 → 由统一客户端进入重新登录流程；
 * - 未实现/未批准的操作**不渲染按钮**（本页不提供删除/取消订单）。
 */
import { Edit, Plus, Refresh, Search, Select, View } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useDetailFlow } from '@/composables/useDetailFlow'
import { useWorkOrderIndex } from '@/composables/useWorkOrderIndex'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { useViewport } from '@/composables/useViewport'
import { ordersService } from '@/services/orders'
import { productsService } from '@/services/products'
import { workOrdersService } from '@/services/work-orders'
import { showWriteError } from '@/services/write-feedback'
import { useAuthStore } from '@/stores/auth'
import type { PageResult } from '@/types/api'
import {
  ORDER_EDITABLE_BASE_STATUS,
  ORDER_STATUS,
  ORDER_STATUS_TAG,
  ORDER_STATUS_VALUES,
  type Order,
  type OrderConfirmation,
} from '@/types/order'
import type { Product } from '@/types/product'
import type { WorkOrder } from '@/types/work-order'
import { formatId, formatNullableText } from '@/utils/format'
import { canOperateOrder, normalizeDateRange } from '@/utils/order-view'

const authStore = useAuthStore()
const { isNarrow } = useViewport()

/** 契约 §5.2：订单写操作仅 admin / manager；这里只控制入口显隐，后端仍会鉴权 */
const canWrite = computed(() => authStore.can('orders:write'))

/** 窄屏（390px）下抽屉占满宽度，避免横向溢出 */
const drawerSize = computed(() => (isNarrow.value ? '100%' : '620px'))

// ---------------------------------------------------------------- 列表

const listTask = useAsyncTask<PageResult<Order>>()

const filters = reactive({
  status: '',
  productCode: '',
  keyword: '',
  // ⚠️ el-date-picker 的 daterange 在**清空后置为 null**（不是 []），
  // 因此类型必须允许 null，且取值一律经 normalizeDateRange() 归一化。
  dueDateRange: null as string[] | null,
})

const page = ref(1)
const pageSize = ref(20)

/**
 * 工单索引（完整背景见 composables/useWorkOrderIndex.ts）：
 * 记录「已有工单的订单 ID」及索引是否**完整**，用于把派生展示状态还原成生命周期判定
 * （超期的待确认订单会被展示为「已延期」，契约 §6.1 的 Order 形状冻结、不能加字段）。
 *
 * ⚠️ 修复记录：
 * - 审查第三轮 P2「只取前 100 张 / 失败后置空集合」→ 分页拉全 + 不完整时判「未知」，见组合式函数；
 * - 审查第四轮 P2「刷新期间沿用旧工单索引」→ ① `loadOrders()` **立即** `invalidate()`；
 *   ② 刷新流程带代数令牌，被取代的迟到轮次不得写任何状态（见 `refreshOrders`）。
 */
const workOrderIndex = useWorkOrderIndex({
  fetchPage: (indexPage, indexPageSize) =>
    workOrdersService.list({ page: indexPage, pageSize: indexPageSize }),
})

/** 刷新代数：`loadOrders()` 每次自增；被取代的迟到轮次凭此放弃写入 */
let refreshGeneration = 0

/** 该订单是否有关联工单；`null` = 未知（索引不完整、查询失败或刷新中） */
function hasWorkOrderOf(orderId: string): boolean | null {
  return workOrderIndex.hasWorkOrderOf(orderId)
}

function currentQuery() {
  const [dueDateFrom, dueDateTo] = normalizeDateRange(filters.dueDateRange)
  return {
    page: page.value,
    pageSize: pageSize.value,
    status: filters.status || undefined,
    productCode: filters.productCode || undefined,
    keyword: filters.keyword || undefined,
    dueDateFrom,
    dueDateTo,
  }
}

async function refreshOrders(token: number): Promise<void> {
  const result = await listTask.run((signal) => ordersService.list(currentQuery(), signal))

  // ⚠️ 本轮已被更新的刷新取代：不得写任何状态（迟到轮次会清掉新一轮的索引）
  if (token !== refreshGeneration) return

  // 只有本页出现「已延期」行时才需要工单索引：
  // 其余状态的可用性由状态本身即可判定（见 utils/order-view.ts#canOperateOrder）
  if (result && result.list.some((row) => row.status === ORDER_STATUS.DELAYED)) {
    await workOrderIndex.load()
    return
  }
  // 本页没有需要索引的行 → 标记为"完整且为空"，避免被误判成"未知"
  workOrderIndex.markEmptyComplete()
}

function loadOrders(): void {
  // ⚠️ 立即失效旧索引（宁缺勿错）：等待列表与新索引期间，依赖索引判定的按钮隐藏
  refreshGeneration += 1
  workOrderIndex.invalidate()
  void refreshOrders(refreshGeneration)
}

function onSearch(): void {
  page.value = 1
  loadOrders()
}

function onReset(): void {
  filters.status = ''
  filters.productCode = ''
  filters.keyword = ''
  filters.dueDateRange = null
  page.value = 1
  loadOrders()
}

/** 是否显示「编辑 / 确认」入口（纯函数判定，见 utils/order-view.ts） */
function canOperate(row: Order): boolean {
  return canOperateOrder({
    status: row.status,
    hasWorkOrder: hasWorkOrderOf(row.id),
    canWrite: canWrite.value,
  })
}

function onPageChange(next: number): void {
  page.value = next
  loadOrders()
}

function onPageSizeChange(next: number): void {
  pageSize.value = next
  page.value = 1
  loadOrders()
}

/** 401 时给出准确说明（后端鉴权尚未接入），避免误判为"操作失败" */
const unauthorized = computed(() => listTask.error.value?.kind === 'unauthenticated')

// ---------------------------------------------------------------- 产品主数据（最小只读）

const productsTask = useAsyncTask<PageResult<Product>>()

const productOptions = computed(() => productsTask.data.value?.list ?? [])

function productLabel(code: string): string {
  const matched = productOptions.value.find((item) => item.code === code)
  return matched ? `${matched.code} · ${matched.name}` : code
}

// ---------------------------------------------------------------- 新建 / 编辑

const formDialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  editingId: '',
})

/** 提交守卫：锁在任何 await 之前同步获取，重复触发不会重复提交（见 composables/useSubmitGuard.ts） */
const { submitting: formSubmitting, run: runFormSubmit } = useSubmitGuard()

const form = reactive({
  code: '',
  productCode: '',
  qty: 1,
  dueDate: '',
})

const formRef = ref<FormInstance>()

const rules: FormRules = {
  code: [
    { required: true, message: '请输入订单编号', trigger: 'blur' },
    { max: 32, message: '订单编号最长 32 个字符', trigger: 'blur' },
  ],
  productCode: [{ required: true, message: '请选择产品', trigger: 'change' }],
  qty: [{ required: true, message: '请输入数量', trigger: 'blur' }],
  dueDate: [{ required: true, message: '请选择交期', trigger: 'change' }],
}

function openCreate(): void {
  formDialog.mode = 'create'
  formDialog.editingId = ''
  form.code = ''
  form.productCode = ''
  form.qty = 1
  form.dueDate = ''
  formDialog.visible = true
}

function openEdit(order: Order): void {
  formDialog.mode = 'edit'
  formDialog.editingId = order.id
  form.code = order.code
  form.productCode = order.productCode
  form.qty = order.qty
  form.dueDate = order.dueDate
  formDialog.visible = true
}

function submitForm(): void {
  // 修复记录（2026-10-10 S5 审查意见「新建订单的重复提交保护存在窗口」）：
  // 初版先 `await instance.validate()` 再设 submitting，连续两次触发会双双通过校验、
  // 各发一次创建请求。现改为由 useSubmitGuard 在**任何 await 之前**同步加锁。
  void runFormSubmit(async () => {
    const instance = formRef.value
    if (!instance) return
    const valid = await instance.validate().catch(() => false)
    if (!valid) return

    try {
      if (formDialog.mode === 'create') {
        const created = await ordersService.create({
          code: form.code.trim(),
          productCode: form.productCode,
          qty: form.qty,
          dueDate: form.dueDate,
        })
        ElMessage({ type: 'success', message: `订单 ${created.code} 已创建。`, duration: 3000 })
      } else {
        const updated = await ordersService.update(formDialog.editingId, {
          productCode: form.productCode,
          qty: form.qty,
          dueDate: form.dueDate,
        })
        ElMessage({ type: 'success', message: `订单 ${updated.code} 已保存。`, duration: 3000 })
      }
      formDialog.visible = false
      loadOrders()
      if (drawer.visible && drawer.order) loadDetail(drawer.order.id)
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- 确认订单

const confirmDialog = reactive({
  visible: false,
  order: null as Order | null,
  result: null as OrderConfirmation | null,
})

/** 确认操作同样走提交守卫 */
const { submitting: confirmSubmitting, run: runConfirmSubmit } = useSubmitGuard()

function openConfirm(order: Order): void {
  confirmDialog.order = order
  confirmDialog.result = null
  confirmDialog.visible = true
}

function submitConfirm(): void {
  // 与 submitForm 相同：锁在任何 await 之前同步获取
  void runConfirmSubmit(async () => {
    const order = confirmDialog.order
    if (!order) return

    try {
      const result = await ordersService.confirm(order.id, ORDER_EDITABLE_BASE_STATUS)
      confirmDialog.result = result
      ElMessage({
        type: 'success',
        message: `订单 ${order.code} 已确认，生成工单 ${result.workOrders.length} 张、工序任务 ${result.workOrders[0]?.taskCount ?? 0} 道。`,
        duration: 4000,
      })
      // 真实成功响应之后才刷新：订单列表 + 关联工单（不靠本地猜状态）
      loadOrders()
      if (drawer.visible && drawer.order?.id === order.id) loadDetail(order.id)
    } catch (error) {
      showWriteError(error)
    }
  })
}

// ---------------------------------------------------------------- 详情抽屉

const drawer = reactive({
  visible: false,
  order: null as Order | null,
})

/**
 * 详情流程用 `useDetailFlow` 统一编排（详情 + 关联工单）。
 *
 * 修复记录（2026-10-10 S5 审查 P2「旧详情流程覆盖新对象的关联数据」）：
 * 初版把两者拆成两个独立任务，先点 A 再点 B 时，A 的详情请求虽被取消，
 * 但其续行仍会启动 A 的关联查询，最终呈现「B 的详情 + A 的关联」。
 * `useDetailFlow` 用轮次标识把整条链路绑在一起：被取代的轮次在第一个 await 后即停止。
 */
const detailFlow = useDetailFlow<Order, PageResult<WorkOrder>>({
  fetchDetail: (id, signal) => ordersService.detail(id, signal),
  fetchRelated: (id, signal) =>
    workOrdersService.list({ saleOrderId: id, page: 1, pageSize: 20 }, signal),
})

function loadDetail(id: string): void {
  void detailFlow.run(id)
}

function openDetail(order: Order): void {
  drawer.order = order
  drawer.visible = true
  loadDetail(order.id)
}

function closeDrawer(): void {
  drawer.visible = false
  drawer.order = null
  detailFlow.reset()
}

const relatedWorkOrders = computed(() => detailFlow.related.value?.list ?? [])

/** 详情中的订单以接口返回为准；未加载完成时回退到列表行（仅用于占位） */
const detailOrder = computed(() => detailFlow.detail.value ?? drawer.order)

const route = useRoute()

onMounted(() => {
  if (route.query.productCode && typeof route.query.productCode === 'string') {
    filters.productCode = route.query.productCode
  }
  if (route.query.status && typeof route.query.status === 'string') {
    filters.status = route.query.status
  }
  if (
    route.query.dueDateFrom &&
    route.query.dueDateTo &&
    typeof route.query.dueDateFrom === 'string' &&
    typeof route.query.dueDateTo === 'string'
  ) {
    filters.dueDateRange = [route.query.dueDateFrom, route.query.dueDateTo]
  }

  void productsTask.run((signal) => productsService.list({ page: 1, pageSize: 100 }, signal))
  loadOrders()
})
</script>

<template>
  <div class="orders">
    <el-alert
      v-if="unauthorized"
      class="orders__notice"
      type="warning"
      :closable="false"
      show-icon
      title="后端鉴权尚未接入，业务接口当前不可用"
      description="业务操作需要真实 JWT 登录；当前页面按服务端 RBAC 返回结果展示可用操作。"
    />

    <section class="mes-card">
      <el-form class="orders__toolbar" inline @submit.prevent>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 130px">
            <el-option v-for="item in ORDER_STATUS_VALUES" :key="item" :label="item" :value="item" />
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
        <el-form-item label="订单编号">
          <el-input
            v-model="filters.keyword"
            placeholder="按订单编号模糊查询"
            clearable
            style="width: 200px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="交期">
          <el-date-picker
            v-model="filters.dueDateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
          <el-button :icon="Refresh" @click="onReset">重置</el-button>
        </el-form-item>
        <el-form-item v-if="canWrite">
          <el-button type="primary" plain :icon="Plus" @click="openCreate">新建订单</el-button>
        </el-form-item>
      </el-form>

      <LoadingState v-if="listTask.loading.value" />
      <ErrorState
        v-else-if="listTask.error.value"
        :error="listTask.error.value"
        retryable
        @retry="loadOrders"
      />
      <EmptyState v-else-if="(listTask.data.value?.list.length ?? 0) === 0" text="没有符合条件的订单" />
      <template v-else>
        <div class="table-scroll">
          <el-table :data="listTask.data.value?.list ?? []" size="small" border stripe>
            <el-table-column label="订单编号" prop="code" min-width="170" />
            <el-table-column label="产品编号" prop="productCode" min-width="140" />
            <el-table-column label="数量" prop="qty" width="90" align="right" />
            <el-table-column label="交期" prop="dueDate" width="120" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="ORDER_STATUS_TAG[row.status] ?? 'info'">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" min-width="180">
              <template #default="{ row }">{{ formatNullableText(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="数据来源" width="110">
              <template #default="{ row }">
                <DataSourceTag :data-source="row.dataSource" :data-label="row.dataLabel" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="210" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :icon="View" @click="openDetail(row)">详情</el-button>
                <!--
                  可编辑/可确认的判据不是展示状态，而是「生命周期仍为待确认」
                  （由有无关联工单推导）—— 否则超期的待确认订单会因被展示成
                  「已延期」而失去入口。见 utils/order-view.ts。
                -->
                <template v-if="canOperate(row)">
                  <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
                  <el-button link type="success" :icon="Select" @click="openConfirm(row)">确认</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="orders__pager">
          <el-pagination
            :current-page="page"
            :page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="listTask.data.value?.total ?? 0"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="onPageChange"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </section>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="formDialog.visible"
      :title="formDialog.mode === 'create' ? '新建生产订单' : '编辑生产订单'"
      width="520px"
      :close-on-click-modal="false"
      @closed="formRef?.clearValidate()"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" @submit.prevent>
        <el-form-item label="订单编号" prop="code">
          <el-input
            v-model="form.code"
            :disabled="formDialog.mode === 'edit'"
            placeholder="例如 SO-20261010-001"
            maxlength="32"
            @keyup.enter="submitForm"
          />
        </el-form-item>
        <el-form-item label="产品" prop="productCode">
          <el-select v-model="form.productCode" placeholder="请选择产品" filterable style="width: 100%">
            <el-option
              v-for="item in productOptions"
              :key="item.code"
              :label="`${item.code} · ${item.name}`"
              :value="item.code"
            />
          </el-select>
          <p class="orders__hint">
            仅有 JC-PLC-2001 具备可拆解的工序明细；其余产品确认工单时会返回 30005（缺少必要前置数据）。
          </p>
        </el-form-item>
        <el-form-item label="数量" prop="qty">
          <el-input-number v-model="form.qty" :min="1" :max="2147483647" :precision="0" />
        </el-form-item>
        <el-form-item label="交期" prop="dueDate">
          <el-date-picker
            v-model="form.dueDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择交期"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="formSubmitting" @click="formDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="formSubmitting" @click="submitForm">
          {{ formDialog.mode === 'create' ? '创建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 确认订单 -->
    <el-dialog v-model="confirmDialog.visible" title="确认生产订单" width="560px" :close-on-click-modal="false">
      <template v-if="!confirmDialog.result">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="确认后将在同一事务内生成唯一一张工单，并按工艺路线复制工序任务"
          description="一张订单只生成一张工单（契约 §6.2）；无工序明细时整个事务回滚，不留下残缺数据。"
        />
        <el-descriptions class="orders__confirm-desc" :column="1" size="small" border>
          <el-descriptions-item label="订单编号">{{ confirmDialog.order?.code }}</el-descriptions-item>
          <el-descriptions-item label="产品编号">{{ confirmDialog.order?.productCode }}</el-descriptions-item>
          <el-descriptions-item label="数量">{{ confirmDialog.order?.qty }}</el-descriptions-item>
          <el-descriptions-item label="交期">{{ confirmDialog.order?.dueDate }}</el-descriptions-item>
        </el-descriptions>
      </template>
      <template v-else>
        <el-result icon="success" title="确认完成" :sub-title="`订单状态：${confirmDialog.result.status}`">
          <template #extra>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item
                v-for="item in confirmDialog.result.workOrders"
                :key="item.id"
                label="生成工单"
              >
                {{ item.code }}（工序任务 {{ item.taskCount }} 道）
              </el-descriptions-item>
            </el-descriptions>
          </template>
        </el-result>
      </template>
      <template #footer>
        <el-button :disabled="confirmSubmitting" @click="confirmDialog.visible = false">
          {{ confirmDialog.result ? '关闭' : '取消' }}
        </el-button>
        <el-button
          v-if="!confirmDialog.result"
          type="primary"
          :loading="confirmSubmitting"
          @click="submitConfirm"
        >
          确认并生成工单
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-drawer
      v-model="drawer.visible"
      title="订单详情"
      :size="drawerSize"
      :destroy-on-close="false"
      @closed="closeDrawer"
    >
      <LoadingState v-if="detailFlow.loading.value" />
      <ErrorState v-else-if="detailFlow.error.value" :error="detailFlow.error.value" />
      <template v-else-if="detailOrder">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="订单 ID">{{ formatId(detailOrder.id) }}</el-descriptions-item>
          <el-descriptions-item label="订单编号">{{ detailOrder.code }}</el-descriptions-item>
          <el-descriptions-item label="产品">
            {{ productLabel(detailOrder.productCode) }}
          </el-descriptions-item>
          <el-descriptions-item label="数量">{{ detailOrder.qty }}</el-descriptions-item>
          <el-descriptions-item label="交期">{{ detailOrder.dueDate }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="ORDER_STATUS_TAG[detailOrder.status] ?? 'info'">
              {{ detailOrder.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建人">
            {{ formatId(detailOrder.createdBy) }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatNullableText(detailOrder.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="数据来源">
            <DataSourceTag :data-source="detailOrder.dataSource" :data-label="detailOrder.dataLabel" />
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="orders__subtitle">关联工单</h4>
        <LoadingState v-if="detailFlow.loading.value" min-height="80px" />
        <ErrorState v-else-if="detailFlow.error.value" :error="detailFlow.error.value" min-height="80px" />
        <EmptyState
          v-else-if="relatedWorkOrders.length === 0"
          text="尚未生成工单"
          description="确认订单后会自动生成唯一一张工单。"
          min-height="80px"
        />
        <div v-else class="table-scroll">
          <el-table :data="relatedWorkOrders" size="small" border>
            <el-table-column label="工单编号" prop="code" min-width="170" />
            <el-table-column label="计划数量" prop="qty" width="100" align="right" />
            <el-table-column label="状态" prop="status" width="100" />
            <el-table-column label="计划区间" min-width="190">
              <template #default="{ row }">
                {{ formatNullableText(row.planStart) }} ~ {{ formatNullableText(row.planEnd) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <EmptyState v-else text="未选择订单" />
    </el-drawer>
  </div>
</template>

<style scoped>
.orders {
  display: flex;
  flex-direction: column;
  gap: var(--mes-space-3);
}

.orders__notice {
  margin-bottom: var(--mes-space-1);
}

.orders__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mes-space-1);
  margin-bottom: var(--mes-space-3);
}

.orders__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--mes-space-3);
}

.orders__hint {
  margin: 4px 0 0;
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-xs);
  line-height: 1.5;
}

.orders__confirm-desc {
  margin-top: var(--mes-space-3);
}

.orders__subtitle {
  margin: var(--mes-space-4) 0 var(--mes-space-2);
  font-size: var(--mes-font-size-md);
}

@media (max-width: 768px) {
  .orders__toolbar :deep(.el-form-item) {
    margin-right: 0;
    width: 100%;
  }
}
</style>
