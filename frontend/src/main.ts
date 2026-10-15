import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router'
import { sanitizeRedirect } from './router/redirect'
import { setAccessTokenProvider, setUnauthorizedHandler } from './services/http'
import { showInfo } from './services/notify'
import { useAppStore } from './stores/app'
import { useAuthStore } from './stores/auth'
import './styles/variables.css'
import './styles/index.css'

const app = createApp(App)
const pinia = createPinia()

// pinia 必须先于 router 安装：路由守卫中会使用 store
app.use(pinia)

const authStore = useAuthStore(pinia)
const appStore = useAppStore(pinia)

// 访问令牌只从内存读取，绝不写入 localStorage / sessionStorage
setAccessTokenProvider(() => authStore.accessToken)

// 401：清理认证状态并进入登录流程；只在「此前确实持有令牌」时触发（避免跳转循环与重复弹窗）
setUnauthorizedHandler(() => {
  if (!authStore.isAuthenticated) return
  authStore.clearSession()
  appStore.exitSkeletonPreview()
  showInfo('登录状态已失效，请重新登录。')
  const current = router.currentRoute.value
  if (current.name !== 'login') {
    void router.replace({ name: 'login', query: { redirect: sanitizeRedirect(current.fullPath) } })
  }
})

app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')

// B13 PWA：仅生产构建注册 Service Worker（开发期不拦截 HMR）。
// 外壳缓存只含静态资源，不缓存 /api/ 业务响应与令牌（见 public/sw.js）。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败（如无痕模式）不影响站点使用，页面按在线应用继续工作
    })
  })
}
