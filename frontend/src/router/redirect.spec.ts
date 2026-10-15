import { describe, expect, it } from 'vitest'

import { sanitizeRedirect } from './redirect'

describe('sanitizeRedirect（防开放重定向）', () => {
  it('保留站内路径（含查询串与中文）', () => {
    expect(sanitizeRedirect('/orders')).toBe('/orders')
    expect(sanitizeRedirect('/orders?status=待确认&page=2')).toBe('/orders?status=待确认&page=2')
    expect(sanitizeRedirect('/ai/data-query?question=SMT-3直通率')).toBe('/ai/data-query?question=SMT-3直通率')
  })

  it('拒绝绝对外部地址', () => {
    expect(sanitizeRedirect('https://evil.example.com/x')).toBe('/')
    expect(sanitizeRedirect('http://evil.example.com')).toBe('/')
    expect(sanitizeRedirect('evil.example.com/x')).toBe('/')
  })

  it('拒绝协议相对地址与反斜杠变体', () => {
    expect(sanitizeRedirect('//evil.example.com/x')).toBe('/')
    expect(sanitizeRedirect('/\\evil.example.com')).toBe('/')
    expect(sanitizeRedirect('/a\\b')).toBe('/')
  })

  it('拒绝伪内部地址（scheme 前缀）', () => {
    expect(sanitizeRedirect('/javascript:alert(1)')).toBe('/')
    expect(sanitizeRedirect('/data:text/html,<script>1</script>')).toBe('/')
  })

  it('拒绝非字符串、空串与含空白的地址', () => {
    expect(sanitizeRedirect(undefined)).toBe('/')
    expect(sanitizeRedirect(null)).toBe('/')
    expect(sanitizeRedirect(123)).toBe('/')
    expect(sanitizeRedirect(['/orders'])).toBe('/')
    expect(sanitizeRedirect('/a b')).toBe('/')
    expect(sanitizeRedirect('   ')).toBe('/')
  })

  it('支持自定义回退值（用于 403/404 的“被拦截地址”展示）', () => {
    expect(sanitizeRedirect('https://evil.example.com', '')).toBe('')
    expect(sanitizeRedirect('/orders', '')).toBe('/orders')
  })
})
