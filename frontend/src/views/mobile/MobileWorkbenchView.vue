<script setup lang="ts">
/**
 * B13 移动端 PWA 工作台（契约 §6.11）。
 *
 * 行为边界（任务书 §B13 + S11 复审 P2 修复）：
 * 1. 复用现有业务 API（work-orders / tasks / reports / sn-traces / devices），
 *    不新增移动端专用业务规则，不增加额外权限（服务端 JWT/RBAC 不变）；
 * 2. 扫码内容只作为查询关键字：经 `validateScanInput` 安全校验，
 *    不当作 SQL、连接串或 URL；
 * 3. 离线时只把**待提交输入**存入本地队列并标记「未提交」；
 *    恢复网络后**由用户逐条确认提交**，绝不自动重试 / 后台补发；
 * 4. 队列**按用户隔离**（存储键含用户 ID，记录带 ownerId，提交前核对归属）：
 *    主动退出清除本人队列；401 / 切换账号立即按新身份重载，不展示他人记录；
 * 5. **区分三种终态**：
 *    - `pending`（未发送，仅离线入队）→ 可确认补交、可修改数量、可移除；
 *    - `pending` + `lastRejection`（确认提交被**明确拒绝**：4xx/30003/30006 等）→
 *      展示拒绝原因、默认展开数量编辑器（「保存修改」后重试）并提供「移除」出口
 *      ——不会出现「只能反复发送同一无效请求」的死循环（复审 P2 #5）；
 *    - `unknown`（已发送但结果不明）→ 只能人工核查后移除；
 * 6. 提交失败按 `classifySubmitFailure` 区分：结果不明 → unknown；明确拒绝 → 记录 rejection 留在 pending；
 * 7. 重复点击由 useSubmitGuard 同步加锁防护；401/403/提交失败均有明确 UI 状态；
 * 8. 本地队列只存业务输入与归属用户 ID，不存令牌；会话存储（sessionStorage），关闭标签页即清除。
 */
import { Camera, Cellphone } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import DataSourceTag from '@/components/DataSourceTag.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { devicesService } from '@/services/devices'
import { showApiError, showInfo, showWarning } from '@/services/notify'
import { ReportsService } from '@/services/reports'
import { snTracesService } from '@/services/sn-traces'
import { useAuthStore } from '@/stores/auth'
import { workOrdersService } from '@/services/work-orders'
import type { PageResult } from '@/types/api'
import type { Device } from '@/types/device'
import type { SnTraceDetail } from '@/types/material'
import type { Task, WorkOrder } from '@/types/work-order'
import {
  clearPendingReports,
  createPendingReport,
  enqueuePendingReport,
  filterOwnedReports,
  isOwnedBy,
  loadPendingReports,
  markPendingReportRejected,
  markPendingReportUnknown,
  partitionPendingReports,
  pendingStorageKeyFor,
  removePendingReport,
  updatePendingReportQuantities,
  type KeyValueStore,
  type PendingReport,
} from '@/utils/offline-queue'
import { hasRejectionNotice, pendingItemActions } from '@/utils/pending-item-actions'
import { classifySubmitFailure } from '@/utils/report-submit-outcome'
import { validateScanInput } from '@/utils/scan-guard'

const router = useRouter()
const auth = useAuthStore()

/** 会话存储（内存降级：无痕模式等抛错场景按内存队列处理） */
const store: KeyValueStore = (() => {
  try {
    const probe = '__mes_probe__';
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    const map = new Map<string, string>();
    return {
      getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    };
  }
})();

// ---------------------------------------------------------------- 网络状态
const online = ref<boolean>(navigator.onLine);
function handleNetwork(): void {
  online.value = navigator.onLine;
}
onMounted(() => {
  window.addEventListener('online', handleNetwork);
  window.addEventListener('offline', handleNetwork);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', handleNetwork);
  window.removeEventListener('offline', handleNetwork);
});

const networkText = computed(() => (online.value ? '在线' : '离线'));

// ---------------------------------------------------------------- 扫码输入
const scanInput = ref('');
const scanError = ref<string | null>(null);

function readScanInput(): string | null {
  const result = validateScanInput(scanInput.value);
  if (!result.ok || result.normalized === null) {
    scanError.value = result.reason ?? '扫码内容不合法';
    showWarning(scanError.value)
    return null;
  }
  scanError.value = null;
  return result.normalized;
}

// ---------------------------------------------------------------- 报工流程
const searchTask = useAsyncTask<PageResult<WorkOrder>>()
const tasksTask = useAsyncTask<PageResult<Task>>()
const currentWorkOrder = ref<WorkOrder | null>(null)
const selectedTask = ref<Task | null>(null)
const qtyForm = ref({ goodQty: '', badQty: '' })
const { submitting: reportSubmitting, run: runReport } = useSubmitGuard()

function searchWorkOrder(): void {
  const code = readScanInput()
  if (!code) return
  selectedTask.value = null
  void searchTask.run((signal) =>
    workOrdersService.list({ keyword: code, page: 1, pageSize: 20 }, signal),
  )
}

function pickWorkOrder(row: WorkOrder): void {
  currentWorkOrder.value = row
  selectedTask.value = null
  void tasksTask.run((signal) => workOrdersService.tasks(row.id, { page: 1, pageSize: 100 }, signal))
}

function pickTask(row: Task): void {
  selectedTask.value = row
}

/** 提交报工：在线直接提交；离线入队（未发送）；结果不明的失败转人工核查 */
function submitReport(): void {
  const task = selectedTask.value
  if (!task) {
    showWarning('请先选择工序任务')
    return
  }
  const ownerId = currentUserId.value
  if (ownerId === null) {
    showWarning('登录状态异常，请重新登录后再报工')
    return
  }
  const goodQty = Number(qtyForm.value.goodQty)
  const badQty = Number(qtyForm.value.badQty)
  if (!Number.isInteger(goodQty) || goodQty < 0 || !Number.isInteger(badQty) || badQty < 0 || goodQty + badQty <= 0) {
    showWarning('良品 / 不良数量必须为非负整数且和大于 0')
    return
  }

  void runReport(async () => {
    if (!online.value) {
      // 从未发送：入队并标记「未提交」
      enqueueOwned(createPendingReport({
        taskId: task.id,
        goodQty,
        badQty,
        ownerId,
        workOrderCode: currentWorkOrder.value?.code ?? null,
        status: 'pending',
      }))
      qtyForm.value = { goodQty: '', badQty: '' }
      return
    }
    try {
      await ReportsService.create({ taskId: task.id, goodQty, badQty })
      qtyForm.value = { goodQty: '', badQty: '' }
      // 刷新任务累计显示
      if (currentWorkOrder.value) {
        void tasksTask.run((signal) =>
          workOrdersService.tasks(currentWorkOrder.value!.id, { page: 1, pageSize: 100 }, signal),
        )
      }
    } catch (error) {
      showApiError(error)
      if (classifySubmitFailure(error) === 'unknown-result') {
        // 请求可能已被服务端应用：转「结果未知」并清空表单，防止再次发送同一笔报工
        enqueueOwned(createPendingReport({
          taskId: task.id,
          goodQty,
          badQty,
          ownerId,
          workOrderCode: currentWorkOrder.value?.code ?? null,
          status: 'unknown',
        }))
        qtyForm.value = { goodQty: '', badQty: '' }
      }
      // 明确拒绝（参数/冲突/无权限等）：不入队、保留表单数值，用户修正后可直接再次提交
    }
  })
}

// ---------------------------------------------------------------- 待提交队列（按用户隔离）
const currentUserId = computed(() => auth.sessionUser?.id ?? null)
const queueKey = computed(() => pendingStorageKeyFor(currentUserId.value))
const pending = ref<PendingReport[]>([])

/** 从当前用户的存储键加载并做归属过滤（防御跨账号残留） */
function reloadQueue(): void {
  const items = filterOwnedReports(loadPendingReports(store, queueKey.value), currentUserId.value)
  pending.value = items
  // 为每条记录预填编辑草稿（被拒绝的记录会默认展开编辑器）
  for (const item of items) {
    ensureDraft(item)
  }
}
reloadQueue()
// 登录 / 主动退出 / 401 失效 / 切换账号：身份一变立即按新身份重载（无身份时展示为空）
watch(currentUserId, () => {
  reloadQueue()
})

const partition = computed(() => partitionPendingReports(pending.value))
const sendableCount = computed(() => partition.value.sendable.length)
const unknownCount = computed(() => partition.value.unknown.length)
const { submitting: flushSubmitting, run: runFlush } = useSubmitGuard()

/** 统一更新「存储 + 响应式队列」（复审 P2：此前只写存储不更新 pending.value） */
function enqueueOwned(report: PendingReport): void {
  pending.value = enqueuePendingReport(store, queueKey.value, report)
  ensureDraft(report)
}

/** 用户确认后逐条提交「未提交」记录（绝不自动触发） */
function confirmSubmitOne(item: PendingReport): void {
  const actions = pendingItemActions(item, currentUserId.value)
  if (!actions.canSubmit) {
    if (item.status === 'unknown') {
      showWarning('结果未知的记录不能直接补交，请先按说明人工核查')
    } else {
      showWarning('该记录不属于当前账号，不能提交')
    }
    return
  }
  if (!online.value) {
    showWarning('当前离线：待提交记录已保留，恢复网络后请再次确认')
    return
  }
  void runFlush(async () => {
    try {
      await ReportsService.create({ taskId: item.taskId, goodQty: item.goodQty, badQty: item.badQty })
      pending.value = removePendingReport(store, queueKey.value, item.id)
      cleanupItemState(item.id)
    } catch (error) {
      showApiError(error)
      if (classifySubmitFailure(error) === 'unknown-result') {
        // 本次发送结果不明：转「结果未知」，不再允许普通补交
        pending.value = markPendingReportUnknown(store, queueKey.value, item.id)
        cleanupItemState(item.id)
      } else {
        // 明确拒绝（400/409/403/30003/30006…）：记录拒绝原因，状态保持 pending。
        // 界面据此展示原因，并提供「修改数量后重试」与「移除」两个出口（复审 P2 #5：
        // 没有出口时用户只能反复发送同一无效请求，形成死循环）。
        const apiError = error as { code?: number | null; message?: string } | null
        pending.value = markPendingReportRejected(store, queueKey.value, item.id, {
          code: typeof apiError?.code === 'number' ? apiError.code : null,
          message: typeof apiError?.message === 'string' && apiError.message ? apiError.message : '服务端拒绝本次提交',
        })
        ensureDraft(item)
      }
    }
  })
}

/** 人工核查后移除「结果未知」记录（用户显式动作；不是自动重试，不代为断言入账） */
function discardUnknownReport(item: PendingReport): void {
  if (!isOwnedBy(item, currentUserId.value)) {
    showWarning('该记录不属于当前账号，不能操作')
    return
  }
  pending.value = removePendingReport(store, queueKey.value, item.id)
  cleanupItemState(item.id)
  showInfo('已移除该记录。若报工列表看不到对应数量，请重新报工。')
}

// ---------------------------------------------------------------- 待提交记录的编辑 / 移除（复审 P2 #5）
/** 每条记录的编辑草稿（按记录 id 隔离，默认用记录当前数量预填） */
const editDrafts = ref<Record<string, { goodQty: string; badQty: string }>>({})
/** 编辑器展开状态（被拒绝的记录默认展开） */
const editorOpen = ref<Record<string, boolean>>({})

function ensureDraft(item: PendingReport): void {
  if (!editDrafts.value[item.id]) {
    editDrafts.value[item.id] = {
      goodQty: String(item.goodQty),
      badQty: String(item.badQty),
    };
  }
}

function isEditorOpen(item: PendingReport): boolean {
  // 明确展开，或有拒绝原因时默认展开（让用户直接看到可改的输入框）
  return editorOpen.value[item.id] === true || hasRejectionNotice(item);
}

function toggleEditor(item: PendingReport): void {
  ensureDraft(item);
  editorOpen.value[item.id] = !isEditorOpen(item);
}

/** 「修改数量后重试」：保存新数量并清除拒绝原因，之后走正常「确认提交」 */
function saveEdit(item: PendingReport): void {
  const actions = pendingItemActions(item, currentUserId.value)
  if (!actions.canEdit) {
    showWarning('结果未知的记录不能修改，请先人工核查')
    return
  }
  const draft = editDrafts.value[item.id];
  const goodQty = Number(draft?.goodQty);
  const badQty = Number(draft?.badQty);
  if (
    !Number.isInteger(goodQty) ||
    goodQty < 0 ||
    !Number.isInteger(badQty) ||
    badQty < 0 ||
    goodQty + badQty <= 0
  ) {
    showWarning('良品 / 不良数量必须为非负整数且和大于 0');
    return;
  }
  pending.value = updatePendingReportQuantities(store, queueKey.value, item.id, { goodQty, badQty });
  // 同步草稿，避免再次展开编辑器时显示旧数量
  editDrafts.value[item.id] = { goodQty: String(goodQty), badQty: String(badQty) };
  editorOpen.value[item.id] = false;
  showInfo('数量已更新，请点击「确认提交」再次发送');
}

/** 「移除」：用户主动清理待提交记录（含被明确拒绝、无法修正的记录） */
function removePendingItem(item: PendingReport): void {
  const actions = pendingItemActions(item, currentUserId.value)
  if (!actions.canRemove) {
    showWarning('结果未知的记录请使用「人工核查后移除」')
    return
  }
  pending.value = removePendingReport(store, queueKey.value, item.id);
  cleanupItemState(item.id);
  showInfo('已移除该待提交记录');
}

/** 清理记录对应的本地编辑状态 */
function cleanupItemState(id: string): void {
  delete editDrafts.value[id];
  delete editorOpen.value[id];
}

// ---------------------------------------------------------------- SN 追溯
const snTask = useAsyncTask<SnTraceDetail>()
function querySn(): void {
  const sn = readScanInput()
  if (!sn) return
  void snTask.run((signal) => snTracesService.detail(sn, signal))
}

// ---------------------------------------------------------------- 设备状态
const deviceTask = useAsyncTask<Device>()
const currentDevice = ref<Device | null>(null)
const transitionForm = ref({ targetStatus: '' })
const { submitting: deviceSubmitting, run: runDevice } = useSubmitGuard()

function queryDevice(): void {
  const code = readScanInput()
  if (!code) return
  void deviceTask.run(async (signal) => {
    const device = await devicesService.detail(code, signal)
    currentDevice.value = device
    transitionForm.value.targetStatus = ''
    return device
  })
}

function submitTransition(): void {
  const device = currentDevice.value
  if (!device) return
  if (!transitionForm.value.targetStatus) {
    showWarning('请选择目标状态')
    return
  }
  void runDevice(async () => {
    try {
      await devicesService.transition(device.code, {
        expectedStatus: device.status,
        targetStatus: transitionForm.value.targetStatus,
      })
      void deviceTask.run((signal) => devicesService.detail(device.code, signal))
    } catch (error) {
      // Q3 未批准时服务端对任何流转返回 30006 —— 如实展示，不伪造本地变更
      showApiError(error)
    }
  })
}

// ---------------------------------------------------------------- 摄像头扫码（渐进增强）
const VIDEO_DETECT_INTERVAL_MS = 400
let mediaStream: MediaStream | null = null
let detectTimer: number | null = null
const cameraActive = ref(false)

async function startCameraScan(): Promise<void> {
  const AnyWindow = window as unknown as {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
    }
    ImageCapture?: unknown
  };
  if (typeof AnyWindow.BarcodeDetector !== 'function' || !navigator.mediaDevices?.getUserMedia) {
    showWarning('当前浏览器不支持摄像头扫码，请手动输入编号')
    return
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    cameraActive.value = true
    const video = document.getElementById('scan-video') as HTMLVideoElement | null
    if (video) {
      video.srcObject = mediaStream
      await video.play()
    }
    const detector = new AnyWindow.BarcodeDetector({ formats: ['code_128', 'qr_code', 'ean_13'] })
    detectTimer = window.setInterval(async () => {
      if (!video) return
      try {
        const codes = await detector.detect(video)
        if (codes.length > 0 && codes[0].rawValue) {
          scanInput.value = codes[0].rawValue
          stopCameraScan()
        }
      } catch {
        // 单帧检测失败不中断扫描
      }
    }, VIDEO_DETECT_INTERVAL_MS)
  } catch (error) {
    showApiError(error)
    cameraActive.value = false
  }
}

function stopCameraScan(): void {
  if (detectTimer !== null) {
    window.clearInterval(detectTimer)
    detectTimer = null
  }
  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
  cameraActive.value = false
}

onBeforeUnmount(stopCameraScan)

function logout(): void {
  // 主动退出：先清除本人队列存储，再清会话（身份 watcher 随即将列表重置为空）
  clearPendingReports(store, queueKey.value)
  auth.clearSession()
  void router.replace({ name: 'login' })
}
</script>

<template>
  <div class="mobile-page">
    <header class="mobile-header">
      <div class="mobile-title">
        <el-icon><Cellphone /></el-icon>
        <span>MES 移动工作台</span>
      </div>
      <div class="mobile-meta">
        <el-tag :type="online ? 'success' : 'danger'" size="small">{{ networkText }}</el-tag>
        <DataSourceTag data-source="demo" data-label="演示数据" />
      </div>
    </header>

    <section class="scan-box">
      <el-input
        v-model="scanInput"
        placeholder="扫码或输入工单编号 / SN / 设备编号"
        clearable
        @keyup.enter="searchWorkOrder"
      />
      <div class="scan-actions">
        <el-button type="primary" @click="searchWorkOrder">查工单</el-button>
        <el-button @click="querySn">查 SN 追溯</el-button>
        <el-button @click="queryDevice">查设备</el-button>
        <el-button :icon="Camera" @click="cameraActive ? stopCameraScan() : startCameraScan()">
          {{ cameraActive ? '停止扫码' : '摄像头扫码' }}
        </el-button>
      </div>
      <p v-if="scanError" class="scan-error">{{ scanError }}</p>
      <video v-show="cameraActive" id="scan-video" class="scan-video" playsinline muted></video>
      <p class="scan-hint">扫码内容只作为查询关键字，不会当作 SQL、连接串或链接执行。</p>
    </section>

    <el-tabs type="border-card" class="mobile-tabs">
      <!-- 报工 -->
      <el-tab-pane label="扫码报工">
        <div v-if="searchTask.loading.value" class="hint">正在查询工单…</div>
        <div v-else-if="searchTask.data.value && searchTask.data.value.list.length > 0">
          <el-radio-group v-model="currentWorkOrder" class="wo-list" @change="pickWorkOrder">
            <el-radio-button
              v-for="wo in searchTask.data.value.list"
              :key="wo.id"
              :value="wo"
              class="wo-item"
            >
              {{ wo.code }}（{{ wo.status }}）
            </el-radio-button>
          </el-radio-group>
        </div>

        <template v-if="currentWorkOrder">
          <h4>工序任务（{{ currentWorkOrder.code }}）</h4>
          <div v-if="tasksTask.loading.value" class="hint">正在加载任务…</div>
          <div v-else-if="tasksTask.data.value && tasksTask.data.value.list.length > 0" class="task-list">
            <el-radio-group v-model="selectedTask" class="wo-list" @change="pickTask">
              <el-radio-button
                v-for="task in tasksTask.data.value.list"
                :key="task.id"
                :value="task"
                class="task-item"
              >
                {{ task.seq }}. {{ task.stepName }}（{{ task.status }}，累计良品 {{ task.goodQty }}）
              </el-radio-button>
            </el-radio-group>
          </div>
          <el-empty v-else description="该工单没有工序任务" :image-size="60" />
        </template>

        <template v-if="selectedTask">
          <h4>报工数量（{{ selectedTask.stepName }}）</h4>
          <div class="qty-row">
            <el-input v-model="qtyForm.goodQty" type="number" min="0" placeholder="良品数" inputmode="numeric" />
            <el-input v-model="qtyForm.badQty" type="number" min="0" placeholder="不良数" inputmode="numeric" />
          </div>
          <el-button
            type="primary"
            size="large"
            class="submit-btn"
            :loading="reportSubmitting"
            :disabled="reportSubmitting"
            @click="submitReport"
          >
            确认报工
          </el-button>
          <p class="hint">提交成功后清空数量；断网时转为「未提交」待确认；提交结果不明时需人工核查，系统不会自动重发。</p>
        </template>
      </el-tab-pane>

      <!-- 待提交 / 待核查 -->
      <el-tab-pane :label="`待提交（${sendableCount}）· 待核查（${unknownCount}）`">
        <div v-if="pending.length === 0" class="hint">没有待提交或待核查记录。</div>

        <template v-if="sendableCount > 0">
          <h4>未提交（尚未发送，恢复网络后可确认补交）</h4>
          <div v-for="item in partition.sendable" :key="item.id" class="pending-item">
            <div class="pending-main">
              <span>任务 {{ item.taskId }}（{{ item.workOrderCode ?? '工单未知' }}）</span>
              <el-tag :type="hasRejectionNotice(item) ? 'danger' : 'warning'" size="small">
                {{ hasRejectionNotice(item) ? '被拒绝' : '未提交' }}
              </el-tag>
            </div>
            <div v-if="hasRejectionNotice(item)" class="rejection-notice">
              上次提交被服务端拒绝（{{
                item.lastRejection?.code != null ? `错误码 ${item.lastRejection.code}` : '错误码未知'
              }}）：{{ item.lastRejection?.message }}。请修改数量后重试，或直接移除该记录。
            </div>
            <div class="pending-sub">
              良品 {{ item.goodQty }} / 不良 {{ item.badQty }} · 保存于 {{ item.createdAt }}
            </div>

            <!-- 编辑区：被拒绝时默认展开；也可手动「修改数量」 -->
            <div v-if="isEditorOpen(item)" class="edit-area">
              <div class="qty-row">
                <el-input v-model="editDrafts[item.id].goodQty" type="number" min="0" placeholder="良品数" inputmode="numeric" />
                <el-input v-model="editDrafts[item.id].badQty" type="number" min="0" placeholder="不良数" inputmode="numeric" />
              </div>
              <el-button size="small" type="primary" @click="saveEdit(item)">保存修改</el-button>
              <el-button
                v-if="!hasRejectionNotice(item)"
                size="small"
                @click="editorOpen[item.id] = false"
              >
                取消
              </el-button>
            </div>

            <div class="pending-actions">
              <el-button
                v-if="!isEditorOpen(item)"
                size="small"
                @click="toggleEditor(item)"
              >
                修改数量
              </el-button>
              <el-button
                size="small"
                type="primary"
                :loading="flushSubmitting"
                :disabled="flushSubmitting || !online"
                @click="confirmSubmitOne(item)"
              >
                确认提交
              </el-button>
              <el-button size="small" type="danger" plain @click="removePendingItem(item)">移除</el-button>
            </div>
          </div>
        </template>

        <template v-if="unknownCount > 0">
          <h4>结果未知（已发送，必须人工核查）</h4>
          <el-alert
            type="warning"
            :closable="false"
            title="这些报工已经发出，但服务端结果不明（可能已入账）。请到「工序报工」列表核对数量：未入账请重新报工；确认无需补报后点「人工核查后移除」。系统不会自动重发，也不会代为断定是否入账。"
          />
          <div v-for="item in partition.unknown" :key="item.id" class="pending-item">
            <div class="pending-main">
              <span>任务 {{ item.taskId }}（{{ item.workOrderCode ?? '工单未知' }}）</span>
              <el-tag type="danger" size="small">结果未知</el-tag>
            </div>
            <div class="pending-sub">良品 {{ item.goodQty }} / 不良 {{ item.badQty }} · 保存于 {{ item.createdAt }}</div>
            <el-button size="small" @click="discardUnknownReport(item)">人工核查后移除</el-button>
          </div>
        </template>

        <p class="hint">
          队列按登录账号隔离：仅本人记录可见可交；主动退出会清除本人队列；账号切换或登录失效后只显示当前账号记录。
          被拒绝的记录可修改数量后重试或移除；结果未知的记录只能人工核查后移除。系统不会自动补发。
        </p>
      </el-tab-pane>

      <!-- SN 追溯 -->
      <el-tab-pane label="SN 追溯">
        <div v-if="snTask.loading.value" class="hint">正在查询…</div>
        <div v-else-if="snTask.data.value">
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="SN">{{ snTask.data.value.trace.sn }}</el-descriptions-item>
            <el-descriptions-item label="工单">{{ snTask.data.value.trace.workOrderId }}</el-descriptions-item>
            <el-descriptions-item label="质检结果">{{ snTask.data.value.trace.qcResult ?? '暂无数据' }}</el-descriptions-item>
            <el-descriptions-item label="覆盖率">{{ snTask.data.value.coverage }}</el-descriptions-item>
          </el-descriptions>
          <p class="hint">限制：{{ snTask.data.value.limitations.join('；') }}</p>
        </div>
        <el-empty v-else-if="snTask.error.value" :description="'查询失败'"></el-empty>
        <div v-else class="hint">输入或扫码 SN 后点击「查 SN 追溯」。</div>
      </el-tab-pane>

      <!-- 设备状态 -->
      <el-tab-pane label="设备状态">
        <div v-if="deviceTask.loading.value" class="hint">正在查询…</div>
        <template v-else-if="currentDevice">
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="设备编号">{{ currentDevice.code }}</el-descriptions-item>
            <el-descriptions-item label="名称">{{ currentDevice.name }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">{{ currentDevice.status }}</el-descriptions-item>
          </el-descriptions>
          <div class="qty-row">
            <el-select v-model="transitionForm.targetStatus" placeholder="目标状态" style="flex: 1">
              <el-option label="运行中" value="运行中" />
              <el-option label="待机" value="待机" />
              <el-option label="维修中" value="维修中" />
              <el-option label="停机" value="停机" />
            </el-select>
            <el-button
              type="primary"
              :loading="deviceSubmitting"
              :disabled="deviceSubmitting"
              @click="submitTransition"
            >
              提交变更
            </el-button>
          </div>
          <p class="hint">设备允许流转表未批准前，服务端会对任何变更返回 30006，此为预期拒绝。</p>
        </template>
        <div v-else class="hint">输入或扫码设备编号后点击「查设备」。</div>
      </el-tab-pane>
    </el-tabs>

    <footer class="mobile-footer">
      <span>{{ auth.displayName ?? '' }}（{{ auth.role ?? '' }}）</span>
      <el-button size="small" @click="logout">退出登录</el-button>
    </footer>
  </div>
</template>

<style scoped>
.mobile-page {
  max-width: 560px;
  margin: 0 auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mobile-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 600;
}

.mobile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scan-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scan-actions .el-button {
  flex: 1 1 40%;
  min-height: 44px;
}

.scan-error {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 13px;
}

.scan-hint,
.hint {
  margin: 0;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.6;
}

.scan-video {
  width: 100%;
  max-height: 220px;
  background: #000;
  border-radius: 6px;
}

.mobile-tabs {
  --el-tabs-header-height: 48px;
}

.wo-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.wo-list :deep(.el-radio-button) {
  width: 100%;
}

.wo-list :deep(.el-radio-button__inner) {
  width: 100%;
  min-height: 44px;
  line-height: 22px;
  white-space: normal;
}

.task-list {
  margin-top: 8px;
}

.qty-row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}

.qty-row .el-input {
  flex: 1;
}

.submit-btn {
  width: 100%;
  min-height: 48px;
  font-size: 16px;
}

.pending-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  margin-bottom: 8px;
}

.pending-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.rejection-notice {
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--el-color-danger-light-9, #fef0f0);
  color: var(--el-color-danger, #f56c6c);
  font-size: 12px;
  line-height: 1.6;
}

.edit-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pending-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pending-sub {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}

.mobile-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 12px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
}
</style>
