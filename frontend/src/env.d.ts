/// <reference types="vite/client" />

/**
 * 环境变量类型（前端可见）。
 *
 * ⚠️ 所有 `VITE_*` 变量都会进入浏览器产物；此处**只允许**放置非敏感配置。
 * 严禁出现 AI_SERVICE_TOKEN / AI_API_KEY / DB_PASSWORD / JWT_SECRET。
 */
interface ImportMetaEnv {
  /** 骨架预览开关，字符串 "true" 才视为开启；缺省即关闭 */
  readonly VITE_ENABLE_SKELETON_PREVIEW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
