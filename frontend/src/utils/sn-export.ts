/**
 * SN 追溯导出的下载辅助（B6，Q7）。
 *
 * 约束：
 * - 导出内容由后端返回（JSON 字符串），前端只负责落盘；
 * - 文件名必须**消毒**：去掉路径分隔符与控制字符、限制长度、限制扩展名，
 *  防止把内容写到任意路径或产生畸形文件名（「导出文件名和内容必须安全」）；
 * - 导出的 JSON 只含追溯字段，不含账号、令牌或密码哈希（后端已保证，
 *   前端不额外拼接任何敏感信息）。
 */

/** 允许保留在文件名中的字符：字母、数字、点、连字符、下划线 */
const SAFE_CHARS = /[^A-Za-z0-9._-]/g

export const EXPORT_FILE_NAME_MAX_LENGTH = 80

/**
 * 消毒导出文件名。
 *
 * - 去掉路径分隔符与控制字符（防目录穿越）；
 * - 压缩空白；仅保留白名单字符；
 * - 超长时保留扩展名并截断主体；
 * - 结果为空时回退到 `sn-trace-export.json`。
 */
export function sanitizeExportFileName(rawName: string): string {
  const input = typeof rawName === 'string' ? rawName : ''
  // 去掉路径分隔符与控制字符（含 NUL、换行等）—— 控制字符匹配是有意为之
  // eslint-disable-next-line no-control-regex
  const withoutPath = input.replace(/[/\\]+/g, '-').replace(/[\u0000-\u001f\u007f]/g, '')
  const compressed = withoutPath.trim().replace(/\s+/g, '-')
  const cleaned = compressed.replace(SAFE_CHARS, '').replace(/^[.-]+/, '')
  if (cleaned.length === 0) return 'sn-trace-export.json'
  if (cleaned.length <= EXPORT_FILE_NAME_MAX_LENGTH) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : ''
  const head = cleaned.slice(0, EXPORT_FILE_NAME_MAX_LENGTH - ext.length)
  return `${head.replace(/[.-]+$/, '')}${ext}`
}

/**
 * 在浏览器中触发一次 JSON 下载（仅浏览器环境）。
 * 返回是否成功触发；非浏览器环境返回 false（测试环境可据此跳过）。
 */
export function downloadJsonExport(fileName: string, content: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false
  }
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = sanitizeExportFileName(fileName)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // 让浏览器有机会开始下载后再回收 URL
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}
