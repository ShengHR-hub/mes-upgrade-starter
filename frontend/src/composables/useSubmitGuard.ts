/**
 * 提交守卫：保证「同一操作不会因重复触发而重复提交」。
 *
 * 为什么需要单独的抽象（S5 审查意见「新建订单的重复提交保护存在窗口」）：
 * 常见写法是
 * ```ts
 * if (submitting.value) return
 * const valid = await form.validate()   // ← 这里有 await
 * if (!valid) return
 * submitting.value = true               // ← 锁加晚了
 * ```
 * 连续两次触发（快速双击 / 连按回车）会**同时**通过 `if` 判断、**同时**走完校验，
 * 于是各发一次写请求。
 *
 * 本组合式函数把「同步加锁」固化为唯一入口：`run()` 在任何 `await` 之前就置位，
 * 重复调用直接返回 `undefined`（不执行任务），并在 `finally` 中解锁。
 *
 * 配套回归测试：`useSubmitGuard.spec.ts`（并发调用只执行一次）。
 */

import { ref, type Ref } from 'vue'

export interface SubmitGuard {
  /** 是否有提交正在进行（供按钮 loading / disabled 使用） */
  submitting: Ref<boolean>
  /** 在守卫下执行一次提交；重复调用返回 `undefined` 且不执行任务 */
  run: <T>(task: () => Promise<T>) => Promise<T | undefined>
}

export function useSubmitGuard(): SubmitGuard {
  const submitting = ref(false)

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    // ⚠️ 必须**同步**加锁：此处到 `await task()` 之间不得插入任何 await，
    // 否则并发调用会在锁生效前双双通过检查（这正是被修复的缺陷）。
    if (submitting.value) return undefined
    submitting.value = true
    try {
      return await task()
    } finally {
      submitting.value = false
    }
  }

  return { submitting, run }
}
