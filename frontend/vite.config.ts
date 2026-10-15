import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// MES 前端（S4 骨架）
// - 开发端口固定 3000（docs/开发启动指令.md 阶段二）
// - 同源代理：仅把 `/api` 转发到 NestJS 3001（契约 §2.1）
// - 明确不代理 `/api/v1/ai/*` 到 FastAPI 8000（契约 §4.1：内部接口不可暴露给浏览器）
// - 不用 setGlobalPrefix 的后端路径为 `/api/v1/...`，代理前缀 `/api` 可同时覆盖
//   `/api/v1/health` 与运维别名 `/health` 不需要代理（后者不在前端调用范围）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
})
