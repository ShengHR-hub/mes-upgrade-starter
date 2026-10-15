import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// 只跑纯逻辑单测（错误映射 / 权限与守卫 / 格式化），不引入 jsdom 等额外依赖。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
  },
})
