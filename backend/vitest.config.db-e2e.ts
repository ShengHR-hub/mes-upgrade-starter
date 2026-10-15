import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * S5 端到端自测（**需要真实 MySQL 与 DB_PASSWORD**）。
 *
 * 与默认 `test:e2e` 分开配置，避免在未注入数据库口令的环境里
 * 把 S2 的健康检查回归也一起跑失败。
 *
 * 运行：
 *   DB_PASSWORD="<口令>" npm run test:e2e:db
 */
const dbPassword = process.env.DB_PASSWORD;

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.db-e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // vitest 默认已把 process.env 继承给 worker；此处**显式**透传 DB_PASSWORD，
    // 以彻底排除「主进程有变量、worker 拿不到」这一类环境问题。
    // 只在已注入时才声明 —— 否则会把"未设置"变成"空字符串"，误导 spec 里的诊断信息。
    ...(dbPassword ? { env: { DB_PASSWORD: dbPassword } } : {}),
  },
});
