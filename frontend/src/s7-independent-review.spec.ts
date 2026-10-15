import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { useSubmitGuard } from './composables/useSubmitGuard'
import * as workOrderTypes from './types/work-order'

const nativeRequire = createRequire(import.meta.url)

// 执行真实SFC的setup逻辑；不挂载DOM，不声称浏览器或JSDOM验收。
function harness(view: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`./views/${view}`, import.meta.url), 'utf8')
  const descriptor = parse(source).descriptor
  const code = compileScript(descriptor, { id: 'independent-review' }).content
  const tasks: any[] = []
  const mounted: (() => void)[] = []
  const router = { push: vi.fn(async () => {}) }
  const messages = { warning: vi.fn(), success: vi.fn() }
  const confirm = vi.fn(async () => {})
  const modules: Record<string, any> = {
    'vue': { ...vue, onMounted: (fn: () => void) => mounted.push(fn) },
    'vue-router': { useRouter: () => router },
    'element-plus': { ElMessage: messages, ElMessageBox: { confirm } },
    '@/composables/useSubmitGuard': { useSubmitGuard },
    '@/composables/useDetailFlow': { useDetailFlow: () => ({ currentId: vue.ref(null), data: vue.shallowRef(null), loading: vue.ref(false), error: vue.shallowRef(null), run: vi.fn(), reset: vi.fn() }) },
    '@/composables/useViewport': { useViewport: () => ({ isNarrow: vue.ref(false) }) },
    '@/composables/useAsyncTask': { useAsyncTask: () => {
      const task = { data: vue.shallowRef(null), loading: vue.ref(false), error: vue.shallowRef(null),
        run: vi.fn(async (callback: any) => { const result = await callback(new AbortController().signal); task.data.value = result; return result }) }
      tasks.push(task)
      return task
    } },
    '@/services/dashboards': { DashboardsService: {} },
    '@/services/alerts': { AlertsService: { list: vi.fn(async () => ({ list: [], total: 0 })), transitionState: vi.fn(async () => ({ status: '已确认' })) } },
    '@/stores/auth': { useAuthStore: () => ({ role: 'admin', can: () => true }) },
    '@/services/write-feedback': { showWriteError: vi.fn() },
    '@/utils/format': {},
    '@/types/work-order': workOrderTypes,
    ...overrides,
  }
  const transpiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exported: any = {}
  const module = { exports: exported }
  runInNewContext(transpiled, { exports: exported, module, require: (name: string) => {
    if (name in modules) return modules[name]
    if (name.endsWith('.vue') || name === '@element-plus/icons-vue') return {}
    return nativeRequire(name)
  }, console, Date, AbortController })
  const setup = module.exports.default.setup({}, { expose: () => {} })
  return { setup, router, tasks, mounted, confirm, modules, messages }
}

describe('独立审查：S7页面setup逻辑（无DOM、无真实JWT）', () => {
  it('产线行钻取必须保留该行产线与产品/车间筛选', () => {
    const h = harness('dashboard/DashboardView.vue')
    h.setup.filters.productCode = 'JC-PLC-2001'
    h.setup.filters.workshop = '一车间'
    h.setup.drillToReports('SMT-2线')
    expect((h.router.push.mock.calls as any)[0][0].query).toMatchObject({ prodLine: 'SMT-2线', productCode: 'JC-PLC-2001', workshop: '一车间' })
  })

  it('缺失计划状态下，页面不应展示局部完成率的交付预警', () => {
    const h = harness('dashboard/DashboardView.vue')
    h.tasks[0].data.value = { production: { metrics: { completionRate: 50, calculationStatus: 'insufficient_data' } }, quality: { goodRate: 100 }, device: { counts: { '维修中': 0 } } }
    expect(h.setup.ruleCompRateTriggered.value).toBe(false)
  })

  it('确认弹窗前必须同步加锁，连续两次调用只打开一次确认', async () => {
    const resolvers: (() => void)[] = []
    const confirm = vi.fn(() => new Promise<void>(resolve => resolvers.push(resolve)))
    const h = harness('alerts/AlertsView.vue', { 'element-plus': { ElMessage: { warning: vi.fn(), success: vi.fn() }, ElMessageBox: { confirm } } })
    const alert = { id: '1', status: '未处理', title: 'review' }
    const one = h.setup.handleTransition(alert, '已确认')
    const two = h.setup.handleTransition(alert, '已确认')
    const count = confirm.mock.calls.length
    const locked = h.setup.transitionSubmitting.value
    resolvers.forEach(resolve => resolve())
    await Promise.all([one, two])
    expect({ count, locked }).toEqual({ count: 1, locked: true })
  })

  it('分批确认两次弹窗不能造成两次写请求', async () => {
    const resolvers: (() => void)[] = []
    const confirm = vi.fn(() => new Promise<void>(resolve => resolvers.push(resolve)))
    const transitionState = vi.fn(async () => ({ id: '1', status: '已确认' }))
    const h = harness('alerts/AlertsView.vue', {
      'element-plus': { ElMessage: { warning: vi.fn(), success: vi.fn() }, ElMessageBox: { confirm } },
      '@/services/alerts': { AlertsService: { list: vi.fn(async () => ({ list: [], total: 0 })), transitionState } },
    })
    const alert = { id: '1', status: '未处理', title: 'review' }
    const one = h.setup.handleTransition(alert, '已确认')
    const two = h.setup.handleTransition(alert, '已确认')
    resolvers[0]()
    await one
    if (resolvers[1]) resolvers[1]()
    await two
    expect(transitionState).toHaveBeenCalledTimes(1)
  })

  it('观察性核对：详情沿用列表快照，未调用详情API（不作为契约阻断项）', () => {
    const getById = vi.fn(async () => ({ id: '1', status: '已关闭' }))
    const h = harness('alerts/AlertsView.vue', { '@/services/alerts': { AlertsService: { getById } } })
    h.setup.openDetail({ id: '1', status: '未处理', title: '旧列表' })
    expect(getById).not.toHaveBeenCalled()
    expect(h.setup.currentDetailAlert.value.status).toBe('未处理')
  })
})

describe('本轮独立：钻取消费、Q6入口及路由移除', () => {
  it('Q6未批准时admin页面必须关闭流转入口', () => {
    const h = harness('alerts/AlertsView.vue')
    expect(h.setup.canTransition.value).toBe(false)
  })
  for (const entry of [
    { view: 'reports/ReportsView.vue', module: '@/services/reports', key: 'ReportsService' },
    { view: 'quality-inspections/QualityInspectionsView.vue', module: '@/services/quality-inspections', key: 'QualityInspectionsService' },
  ]) {
    it(`${entry.view}实际列表请求必须应用钻取范围`, () => {
      const route = { query: { startDate: '2026-10-09', endDate: '2026-10-09', prodLine: 'SMT-2线', workshop: '一车间', productCode: 'JC-PLC-2001' } }
      const list = vi.fn(async () => ({ list: [], total: 0 }))
      const h = harness(entry.view, {
        'vue-router': { useRoute: () => route },
        [entry.module]: { [entry.key]: { list } },
      })
      h.setup.syncFromRoute()
      h.setup.fetchList()
      expect((list.mock.calls as any)[0]?.[0]).toMatchObject({ prodLine: 'SMT-2线', workshop: '一车间', productCode: 'JC-PLC-2001' })
    })
    it(`${entry.view}移除路由过滤后不得保留旧工单/日期`, () => {
      const route: { query: Record<string, string> } = { query: { workOrderId: '1', startDate: '2026-10-09', endDate: '2026-10-09' } }
      const h = harness(entry.view, {
        'vue-router': { useRoute: () => route },
        [entry.module]: { [entry.key]: { list: vi.fn(async () => ({ list: [], total: 0 })) } },
      })
      h.setup.syncFromRoute()
      route.query = {}
      h.setup.syncFromRoute()
      expect({ id: h.setup.queryForm.workOrderId, range: h.setup.queryForm.dateRange }).toEqual({ id: '', range: null })
    })
  }

  it('WorkOrdersView.vue实际列表请求必须应用产线与车间钻取范围', () => {
    const route = { query: { prodLine: 'SMT-2线', workshop: '一车间', productCode: 'JC-PLC-2001' } }
    const list = vi.fn(async () => ({ list: [], total: 0 }))
    const h = harness('work-orders/WorkOrdersView.vue', {
      'vue-router': { useRoute: () => route },
      '@/services/work-orders': { workOrdersService: { list, detail: vi.fn(), tasks: vi.fn() } },
      '@/services/products': { productsService: { list: vi.fn(async () => ({ list: [] })) } },
    })
    h.setup.syncFromRoute()
    h.setup.loadWorkOrders()
    expect((list.mock.calls as any)[0]?.[0]).toMatchObject({ prodLine: 'SMT-2线', workshop: '一车间', productCode: 'JC-PLC-2001' })
  })

  it('WorkOrdersView.vue移除路由过滤后不得保留旧产线/车间', () => {
    const route: { query: Record<string, string> } = { query: { prodLine: 'SMT-2线', workshop: '一车间', productCode: 'JC-PLC-2001' } }
    const h = harness('work-orders/WorkOrdersView.vue', {
      'vue-router': { useRoute: () => route },
      '@/services/work-orders': { workOrdersService: { list: vi.fn(async () => ({ list: [], total: 0 })), detail: vi.fn(), tasks: vi.fn() } },
      '@/services/products': { productsService: { list: vi.fn(async () => ({ list: [] })) } },
    })
    h.setup.syncFromRoute()
    route.query = {}
    h.setup.syncFromRoute()
    expect({ prodLine: h.setup.filters.prodLine, workshop: h.setup.filters.workshop, productCode: h.setup.filters.productCode }).toEqual({ prodLine: '', workshop: '', productCode: '' })
  })
})

