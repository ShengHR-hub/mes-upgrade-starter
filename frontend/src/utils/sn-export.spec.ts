import { describe, expect, it } from 'vitest'

import {
  EXPORT_FILE_NAME_MAX_LENGTH,
  sanitizeExportFileName,
} from './sn-export'

describe('sanitizeExportFileName', () => {
  it('保留普通文件名不变', () => {
    expect(sanitizeExportFileName('sn-DEMO-SN-001-2026-10-13.json')).toBe(
      'sn-DEMO-SN-001-2026-10-13.json',
    )
  })

  it('拒绝目录穿越：路径分隔符被替换', () => {
    const result = sanitizeExportFileName('../../etc/passwd.json')
    expect(result).not.toContain('/')
    expect(result).not.toContain('\\')
    expect(result.startsWith('.')).toBe(false)
  })

  it('去掉控制字符与首部点号', () => {
    const result = sanitizeExportFileName('..\u0000\u001f sn.json')
    // 控制字符匹配是有意为之：断言输出中不含任何控制字符
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/[\u0000-\u001f]/)
    expect(result.startsWith('.')).toBe(false)
  })

  it('空白压缩为连字符，其余白名单外字符（引号等）被移除', () => {
    expect(sanitizeExportFileName('sn report "A".json')).toBe('sn-report-A.json')
  })

  it('空输入或全部被过滤时回退到默认文件名', () => {
    expect(sanitizeExportFileName('')).toBe('sn-trace-export.json')
    expect(sanitizeExportFileName('///')).toBe('sn-trace-export.json')
  })

  it('超长文件名保留扩展名并截断', () => {
    const long = `${'a'.repeat(200)}.json`
    const result = sanitizeExportFileName(long)
    expect(result.length).toBe(EXPORT_FILE_NAME_MAX_LENGTH)
    expect(result.endsWith('.json')).toBe(true)
    expect(result).not.toContain('..json')
  })

  it('无扩展名的超长名直接截断（不追加内容）', () => {
    const result = sanitizeExportFileName('b'.repeat(150))
    expect(result.length).toBe(EXPORT_FILE_NAME_MAX_LENGTH)
    expect(result.endsWith('.')).toBe(false)
  })
})
