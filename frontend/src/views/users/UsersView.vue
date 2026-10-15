<script setup lang="ts">
/**
 * B9 用户与权限（契约 §5.3）。
 *
 * 边界：
 * - 用户管理入口仅 admin 可见（`users:read` / `users:write`）；前端隐藏**不能替代后端授权**，
 *   越权请求仍会被服务端 20002 / 30001 拒绝；
 * - 密码在提交后立即清空，不写入 store、不打印、不落盘；
 * - 最后一个启用 admin 的停用 / 降级由服务端并发保护拒绝（30007），本页如实展示原因，
 *   不做本地乐观更新；
 * - 三角色权限清单为只读对照（GET /role-permissions），用于核对后端授权口径。
 */
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'

import EmptyState from '@/components/state/EmptyState.vue'
import ErrorState from '@/components/state/ErrorState.vue'
import LoadingState from '@/components/state/LoadingState.vue'
import { useAsyncTask } from '@/composables/useAsyncTask'
import { useSubmitGuard } from '@/composables/useSubmitGuard'
import { showApiError, showInfo, showWarning } from '@/services/notify'
import { accountService, logsService, usersService } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import type { PageResult } from '@/types/api'
import { ROLES, ROLE_SHORT_LABELS, type Role } from '@/types/role'
import type { RolePermissions, User } from '@/types/user'

const auth = useAuthStore()

const canManage = computed(() => auth.can('users:write'))
const listTask = useAsyncTask<PageResult<User>>()
const roleTask = useAsyncTask<RolePermissions>()

const query = reactive<{ keyword: string; role: Role | ''; enabled: '' | 'true' | 'false' }>({
  keyword: '',
  role: '',
  enabled: '',
})

const list = computed(() => listTask.data.value?.list ?? [])

function fetchList(): void {
  void listTask.run((signal) =>
    usersService.list(
      {
        keyword: query.keyword.trim() || undefined,
        role: query.role || undefined,
        enabled: query.enabled === '' ? undefined : query.enabled === 'true',
        page: 1,
        pageSize: 50,
      },
      signal,
    ),
  )
}

function fetchRoles(): void {
  void roleTask.run((signal) => logsService.rolePermissions(signal))
}

onMounted(() => {
  fetchList()
  fetchRoles()
})

/* -------------------------------------------------- 新建用户 */
const createVisible = ref(false)
const createFormRef = ref<FormInstance>()
const createGuard = useSubmitGuard()
const createForm = reactive<{
  username: string
  name: string
  password: string
  role: Role
  dept: string
  post: string
  phone: string
}>({ username: '', name: '', password: '', role: 'operator', dept: '', post: '', phone: '' })

const createRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_]{3,32}$/, message: '3~32 位字母 / 数字 / 下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入初始密码', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

function openCreate(): void {
  createForm.username = ''
  createForm.name = ''
  createForm.password = ''
  createForm.role = 'operator'
  createForm.dept = ''
  createForm.post = ''
  createForm.phone = ''
  createVisible.value = true
}

function submitCreate(): void {
  const formElement = createFormRef.value
  if (!formElement) return
  void createGuard.run(async () => {
    const valid = await formElement.validate().catch(() => false)
    if (!valid) return
    try {
      await usersService.create({
        username: createForm.username.trim(),
        name: createForm.name.trim(),
        password: createForm.password,
        role: createForm.role,
        dept: createForm.dept.trim() || undefined,
        post: createForm.post.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
      })
      showInfo('用户已创建')
      createVisible.value = false
      fetchList()
    } catch (error) {
      showApiError(error)
    } finally {
      // 密码不保留在内存表单中
      createForm.password = ''
    }
  })
}

/* -------------------------------------------------- 编辑用户 */
const editVisible = ref(false)
const editTarget = ref<User | null>(null)
const editGuard = useSubmitGuard()
const editForm = reactive<{
  name: string
  dept: string
  post: string
  phone: string
  role: Role
  enabled: boolean
}>({ name: '', dept: '', post: '', phone: '', role: 'operator', enabled: true })

function openEdit(row: User): void {
  editTarget.value = row
  editForm.name = row.name
  editForm.dept = row.dept ?? ''
  editForm.post = row.post ?? ''
  editForm.phone = row.phone ?? ''
  editForm.role = row.role
  editForm.enabled = row.enabled
  editVisible.value = true
}

function submitEdit(): void {
  const target = editTarget.value
  if (!target) return
  if (!editForm.name.trim()) {
    showWarning('姓名不能为空')
    return
  }
  void editGuard.run(async () => {
    try {
      await usersService.update(target.id, {
        name: editForm.name.trim(),
        dept: editForm.dept.trim() || null,
        post: editForm.post.trim() || null,
        phone: editForm.phone.trim() || null,
        role: editForm.role,
        enabled: editForm.enabled,
      })
      showInfo('用户已更新')
      editVisible.value = false
      fetchList()
    } catch (error) {
      // 最后一个启用 admin 的停用 / 降级由服务端拒绝（30007），不做本地乐观更新
      showApiError(error)
    }
  })
}

/* -------------------------------------------------- 修改自身密码 */
const passwordVisible = ref(false)
const passwordFormRef = ref<FormInstance>()
const passwordGuard = useSubmitGuard()
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const passwordRules: FormRules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [{ required: true, message: '请输入新密码', trigger: 'blur' }],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback: (error?: Error) => void) => {
        if (value !== passwordForm.newPassword) callback(new Error('两次输入的新密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

function openPassword(): void {
  passwordForm.oldPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordVisible.value = true
}

function submitPassword(): void {
  const formElement = passwordFormRef.value
  if (!formElement) return
  void passwordGuard.run(async () => {
    const valid = await formElement.validate().catch(() => false)
    if (!valid) return
    try {
      await accountService.changePassword({
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword,
      })
      showInfo('密码已修改')
      passwordVisible.value = false
    } catch (error) {
      showApiError(error)
    } finally {
      passwordForm.oldPassword = ''
      passwordForm.newPassword = ''
      passwordForm.confirmPassword = ''
    }
  })
}

function roleTagType(role: Role): 'success' | 'warning' | 'info' {
  if (role === 'admin') return 'success'
  if (role === 'manager') return 'warning'
  return 'info'
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h2 class="page__title">用户与权限</h2>
        <p class="page__summary">
          账号管理与三角色权限清单（仅管理员）。密码哈希使用 Argon2id；最后一个启用管理员受并发保护，
          不可停用或降级。前端隐藏入口不代表后端放行。
        </p>
      </div>
      <div class="page__actions">
        <el-button :icon="Refresh" @click="fetchList">刷新</el-button>
        <el-button type="primary" :icon="Plus" :disabled="!canManage" @click="openCreate">新建用户</el-button>
      </div>
    </header>

    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="用户名 / 姓名关键词" style="width: 220px" clearable />
      <el-select v-model="query.role" placeholder="角色" style="width: 150px" clearable>
        <el-option v-for="role in ROLES" :key="role" :label="ROLE_SHORT_LABELS[role]" :value="role" />
      </el-select>
      <el-select v-model="query.enabled" placeholder="状态" style="width: 130px" clearable>
        <el-option label="启用" value="true" />
        <el-option label="停用" value="false" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="fetchList">查询</el-button>
      <el-button @click="openPassword">修改我的密码</el-button>
    </div>

    <LoadingState v-if="listTask.loading.value" />
    <ErrorState v-else-if="listTask.error.value" :error="listTask.error.value" retryable @retry="fetchList" />
    <EmptyState v-else-if="list.length === 0" description="暂无用户数据。" />
    <el-table v-else :data="list" border size="small">
      <el-table-column prop="username" label="用户名" min-width="130" />
      <el-table-column prop="name" label="姓名" min-width="110" />
      <el-table-column label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="roleTagType(row.role)" size="small">{{ ROLE_SHORT_LABELS[row.role as Role] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="dept" label="部门" min-width="120" />
      <el-table-column prop="post" label="岗位" min-width="120" />
      <el-table-column prop="phone" label="电话" min-width="130" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small" effect="plain">
            {{ row.enabled ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" :disabled="!canManage" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- -------------------------------------------------- 三角色权限清单（只读） -->
    <h4 class="block-title">三角色权限清单（只读，用于核对后端授权口径）</h4>
    <LoadingState v-if="roleTask.loading.value" />
    <ErrorState v-else-if="roleTask.error.value" :error="roleTask.error.value" retryable @retry="fetchRoles" />
    <EmptyState v-else-if="!roleTask.data.value || roleTask.data.value.roles.length === 0" description="暂无权限清单。" />
    <el-descriptions v-else :column="1" border size="small">
      <el-descriptions-item
        v-for="entry in roleTask.data.value.roles"
        :key="entry.role"
        :label="ROLE_SHORT_LABELS[entry.role]"
      >
        <span class="perm-list">{{ entry.permissions.join('、') || '（无）' }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <!-- -------------------------------------------------- 新建用户 -->
    <el-dialog v-model="createVisible" title="新建用户" width="560px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createForm.username" placeholder="登录用户名（3~32 位）" autocomplete="off" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="createForm.name" placeholder="真实姓名" />
        </el-form-item>
        <el-form-item label="初始密码" prop="password">
          <el-input v-model="createForm.password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option v-for="role in ROLES" :key="role" :label="ROLE_SHORT_LABELS[role]" :value="role" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="createForm.dept" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="岗位">
          <el-input v-model="createForm.post" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="createForm.phone" placeholder="可留空" />
        </el-form-item>
      </el-form>
      <p class="note">初始密码由服务端以 Argon2id 哈希存储；本页不会回显或记录密码明文。</p>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createGuard.submitting.value" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- -------------------------------------------------- 编辑用户 -->
    <el-dialog v-model="editVisible" :title="editTarget ? `编辑用户：${editTarget.username}` : '编辑用户'" width="560px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="姓名">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="editForm.dept" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="岗位">
          <el-input v-model="editForm.post" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="editForm.phone" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role" style="width: 100%">
            <el-option v-for="role in ROLES" :key="role" :label="ROLE_SHORT_LABELS[role]" :value="role" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="editForm.enabled" />
        </el-form-item>
      </el-form>
      <p class="note">
        停用或降级最后一个启用管理员会被服务端拒绝（并发保护），本页如实展示拒绝原因，不做本地乐观更新。
      </p>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editGuard.submitting.value" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- -------------------------------------------------- 修改自身密码 -->
    <el-dialog v-model="passwordVisible" title="修改我的密码" width="480px">
      <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-width="110px">
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input v-model="passwordForm.oldPassword" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="passwordForm.newPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-form>
      <p class="note">
        改密接口为 <code>POST /api/v1/users/me/password-changes</code>；密码策略与令牌失效范围（Q4）批准前，
        本入口不承诺具体策略，提交后立即清空表单。
      </p>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordGuard.submitting.value" @click="submitPassword">提交</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page__actions {
  display: flex;
  gap: var(--mes-space-2);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mes-space-2);
  margin-bottom: var(--mes-space-3);
  align-items: center;
}

.block-title {
  margin: var(--mes-space-4) 0 var(--mes-space-2);
  font-size: var(--mes-font-size-md);
}

.perm-list {
  color: var(--mes-text-secondary);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
  word-break: break-all;
}

.note {
  color: var(--mes-text-muted);
  font-size: var(--mes-font-size-sm);
  line-height: 1.6;
}

.note code {
  font-family: var(--mes-font-mono);
}
</style>
