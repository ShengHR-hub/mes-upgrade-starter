<script setup lang="ts">
/**
 * 首页 = 模块导航 + 服务健康状态。
 *
 * 硬性约束（S4 要求第 6 条）：
 * - 健康状态调用现有健康接口：**成功才显示正常，连接失败显示不可达**，不假装成功；
 * - 不显示任何虚构的业务指标（订单数 / 产量 / 良品率 / OEE / AI 分析结果）；
 * - 骨架预览与演示数据是两种不同状态，不混淆。
 */
import { Refresh } from '@element-plus/icons-vue'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import DataSourceTag from '@/components/DataSourceTag.vue'
import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { BACKEND_ORIGIN } from '@/config/app'
import { groupedModules } from '@/config/modules'
import { healthService } from '@/services/health'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { HealthData } from '@/types/health'

const router = useRouter()
const authStore = useAuthStore()
const appStore = useAppStore()

const health = useAsyncTask<HealthData>()

const navGroups = computed(() => groupedModules(authStore.role).filter((entry) => entry.group.key !== 'overview'))

const databaseUp = computed(() => health.data.value?.database?.status === 'up')

function loadHealth(): void {
  void health.run((signal) => healthService.get(signal))
}

onMounted(loadHealth)
</script>

<template>
  <div class="home">
    <section class="mes-card home__status">
      <div class="home__status-head">
        <h3 class="home__section-title">系统状态</h3>
        <el-button size="small" :icon="Refresh" :loading="health.loading.value" @click="loadHealth">
          重新检查
        </el-button>
      </div>

      <LoadingState v-if="health.loading.value" text="正在检查后端服务…" min-height="120px" />

      <ErrorState
        v-else-if="health.error.value"
        :error="health.error.value"
        title="后端服务不可达"
        min-height="120px"
        retryable
        @retry="loadHealth"
      />

      <div v-else-if="health.data.value" class="home__status-body">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="后端服务">
            <el-tag :type="health.data.value.status === 'ok' ? 'success' : 'warning'" size="small">
              {{ health.data.value.status === 'ok' ? '正常' : health.data.value.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="服务名">{{ health.data.value.service }}</el-descriptions-item>
          <el-descriptions-item label="版本">{{ health.data.value.version }}</el-descriptions-item>
          <el-descriptions-item label="已运行">
            {{ health.data.value.uptimeSeconds }} 秒
          </el-descriptions-item>
          <el-descriptions-item label="数据库">
            <el-tag :type="databaseUp ? 'success' : 'danger'" size="small">
              {{ databaseUp ? '已连接' : '不可用' }}
            </el-tag>
            <span v-if="health.data.value.database?.version" class="home__muted">
              （MySQL {{ health.data.value.database.version }}）
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="检查时间">{{ health.data.value.timestamp }}</el-descriptions-item>
        </el-descriptions>
        <p class="home__muted">
          数据来源：{{ BACKEND_ORIGIN }} · 同源代理路径 <code>/api/v1/health</code>（公开运维接口，不返回业务数据）
        </p>
      </div>

      <EmptyState v-else text="尚未获取到健康状态" min-height="120px" />
    </section>

    <el-alert
      class="home__notice"
      type="info"
      :closable="false"
      show-icon
      title="本页只做模块导航与服务健康检查"
      description="业务指标（订单数、产量、良品率、OEE、AI 分析结果）将在对应模块实现后接入，本页不展示任何推测数字。"
    />

    <section class="home__nav">
      <div class="home__nav-head">
        <h3 class="home__section-title">模块导航</h3>
        <span class="home__muted">
          {{ authStore.role ? '按当前身份显示可访问模块' : '骨架预览：显示全部模块，未做权限校验' }}
        </span>
      </div>

      <div v-for="entry in navGroups" :key="entry.group.key" class="home__group">
        <h4 class="home__group-title">
          <el-icon><AppIcon :name="entry.group.icon" /></el-icon>
          <span>{{ entry.group.title }}</span>
        </h4>
        <div class="home__cards">
          <button
            v-for="item in entry.modules"
            :key="item.key"
            type="button"
            class="home__card"
            @click="router.push(item.path)"
          >
            <el-icon class="home__card-icon"><AppIcon :name="item.icon" /></el-icon>
            <span class="home__card-title">{{ item.title }}</span>
            <span class="home__card-code">{{ item.code }}</span>
            <span class="home__card-summary">{{ item.summary }}</span>
            <el-tag v-if="!item.implemented" size="small" type="info" effect="plain">尚未实现</el-tag>
          </button>
        </div>
      </div>
    </section>

    <section class="home__legend">
      <h3 class="home__section-title">状态标识说明</h3>
      <ul class="home__legend-list">
        <li>
          <DataSourceTag data-source="enterprise-master" />
          <span>来自企业提供的主数据文件，不是模拟流水。</span>
        </li>
        <li>
          <DataSourceTag data-source="demo" />
          <span>基于真实主数据模拟生成的业务流水，非真实生产数据。</span>
        </li>
        <li>
          <el-tag size="small" type="warning" effect="dark">骨架预览，未登录</el-tag>
          <span>仅用于检查布局与占位页，不代表已登录或已获得权限。</span>
        </li>
        <li>
          <el-tag size="small" type="info" effect="plain">尚未实现</el-tag>
          <span>该模块尚未实现，不提供任何可执行的业务操作。</span>
        </li>
      </ul>
      <p class="home__muted">
        当前预览开关状态：{{ appStore.skeletonPreview ? '已启用骨架预览' : '未启用' }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--mes-space-4);
}

.home__status-head,
.home__nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mes-space-2);
  margin-bottom: var(--mes-space-3);
}

.home__section-title {
  margin: 0;
  font-size: var(--mes-font-size-lg);
  font-weight: 600;
}

.home__status-body {
  display: flex;
  flex-direction: column;
  gap: var(--mes-space-2);
}

.home__muted {
  margin: 0;
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
}

.home__group {
  margin-bottom: var(--mes-space-4);
}

.home__group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 var(--mes-space-2);
  font-size: var(--mes-font-size-md);
  color: var(--mes-text-secondary);
}

.home__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--mes-space-3);
}

.home__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: var(--mes-space-3);
  text-align: left;
  cursor: pointer;
  background: var(--mes-bg-container);
  border: 1px solid var(--mes-border-color-light);
  border-radius: var(--mes-radius);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font: inherit;
  color: inherit;
}

.home__card:hover {
  border-color: var(--el-color-primary);
  box-shadow: var(--mes-shadow-sm);
}

.home__card-icon {
  font-size: 18px;
  color: var(--el-color-primary);
}

.home__card-title {
  font-weight: 600;
}

.home__card-code {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-xs);
}

.home__card-summary {
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
  line-height: 1.5;
}

.home__legend-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
}
</style>
