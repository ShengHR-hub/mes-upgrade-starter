<script setup lang="ts">
/**
 * 登录页。
 *
 * 认证通过后由后端签发真实 JWT；前端不生成假 JWT、不硬编码账号密码。
 * - 表单字段严格对应契约 §5.3 `POST /api/v1/sessions { username, password }`；
 * - 提交为用户显式触发（非自动调用）；未实现时后端返回 404/30001，界面如实展示；
 * - 密码不保存、不打印，提交后立即清空。
 */
import { Lock, User } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { APP_NAME, APP_SUBTITLE } from '@/config/app'
import { SKELETON_PREVIEW_AVAILABLE, SKELETON_PREVIEW_FLAG_DESCRIPTION } from '@/config/skeleton-preview'
import { sanitizeRedirect } from '@/router/redirect'
import { authService } from '@/services/auth'
import { showApiError, showWarning } from '@/services/notify'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()

const formRef = ref<FormInstance>()
const submitting = ref(false)

const form = reactive({
  username: '',
  password: '',
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/** 只接受站内返回地址（防开放重定向） */
const redirectTarget = computed(() => sanitizeRedirect(route.query.redirect))

async function submit(): Promise<void> {
  const formElement = formRef.value
  if (!formElement) return

  const valid = await formElement.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const session = await authService.login({ username: form.username, password: form.password })
    // The session is established only from the backend response.
    authStore.setSession(session)
    appStore.exitSkeletonPreview()
    await router.replace(redirectTarget.value)
  } catch (error) {
    showApiError(error)
  } finally {
    submitting.value = false
    // 密码不保留在内存表单中
    form.password = ''
  }
}

function enterSkeletonPreview(): void {
  if (!appStore.enterSkeletonPreview()) {
    showWarning('当前构建不允许启用骨架预览（仅开发环境显式开启时可用，生产构建始终不可用）。')
    return
  }
  void router.replace(redirectTarget.value)
}
</script>

<template>
  <div class="login">
    <div class="login__card mes-card">
      <header class="login__head">
        <span class="login__mark">JC</span>
        <div>
          <h1 class="login__title">{{ APP_NAME }}</h1>
          <p class="login__subtitle">{{ APP_SUBTITLE }}</p>
        </div>
      </header>

      <el-alert
        class="login__alert"
        type="info"
        :closable="false"
        show-icon
        title="登录使用服务端签发的访问令牌"
      >
        <template #default>
          <p>
            登录接口 <code>POST /api/v1/sessions</code> 校验通过后返回访问令牌（JWT，HS256）。
            令牌仅保存在内存，刷新页面即需重新登录，不写入 localStorage / sessionStorage。
          </p>
          <p>
            每次请求由后端核对账号的启用状态与角色，停用或角色变化会立即影响已有令牌的权限。
          </p>
        </template>
      </el-alert>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        autocomplete="on"
        @submit.prevent="submit"
      >
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" name="username" :prefix-icon="User" placeholder="请输入用户名" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            name="password"
            show-password
            :prefix-icon="Lock"
            placeholder="请输入密码"
            autocomplete="current-password"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="login__submit" :loading="submitting" @click="submit">
            登录
          </el-button>
        </el-form-item>
      </el-form>

      <p class="login__hint">
        凭据错误时后端返回统一提示（不区分账号是否存在）；密码提交后立即从表单内存中清除。
      </p>

      <template v-if="SKELETON_PREVIEW_AVAILABLE">
        <el-divider>仅供验收</el-divider>
        <el-alert
          class="login__alert"
          type="info"
          :closable="false"
          show-icon
          title="骨架预览，未登录"
          description="用于检查布局、菜单与占位页。它不建立登录状态、不授予任何业务权限、不调用业务接口。"
        />
        <el-button class="login__preview" plain @click="enterSkeletonPreview">
          进入骨架预览（未登录）
        </el-button>
        <p class="login__hint">{{ SKELETON_PREVIEW_FLAG_DESCRIPTION }}</p>
      </template>
    </div>

    <footer class="login__footer">
      <router-link to="/404">查看 404 页面</router-link>
    </footer>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mes-space-4);
  min-height: 100vh;
  padding: var(--mes-space-5);
  background: var(--mes-bg-page);
}

.login__card {
  width: 100%;
  max-width: 460px;
  padding: var(--mes-space-5);
}

.login__head {
  display: flex;
  align-items: center;
  gap: var(--mes-space-3);
  margin-bottom: var(--mes-space-4);
}

.login__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--mes-radius);
  background: var(--el-color-primary);
  color: #fff;
  font-weight: 700;
}

.login__title {
  margin: 0;
  font-size: var(--mes-font-size-xl);
}

.login__subtitle {
  margin: 2px 0 0;
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
}

.login__alert {
  margin-bottom: var(--mes-space-4);
}

.login__alert p {
  margin: 0 0 4px;
  line-height: 1.6;
}

.login__alert code {
  font-family: var(--mes-font-mono);
}

.login__submit {
  width: 100%;
}

.login__preview {
  width: 100%;
}

.login__hint {
  margin: var(--mes-space-3) 0 0;
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
}

.login__footer {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
}
</style>
