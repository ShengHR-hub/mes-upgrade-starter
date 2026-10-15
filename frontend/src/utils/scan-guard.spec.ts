import { describe, expect, it } from 'vitest';

import { validateScanInput } from './scan-guard';

/**
 * B13 扫码内容安全守卫单测（任务书 §B13 要求 9 / §九前端测试）。
 *
 * 铁律：扫码内容只作为查询关键字，绝不当作 SQL、连接串或任意 URL。
 */
describe('validateScanInput', () => {
  it('合法编号类内容通过（工单编号 / SN / 设备编号）', () => {
    for (const raw of ['WO-20261009-001', 'DEMO-SN-001', 'EQP-SMT-006', 'MAT_001.02']) {
      const result = validateScanInput(raw);
      expect(result.ok, raw).toBe(true);
      expect(result.normalized).toBe(raw);
      expect(result.reason).toBeNull();
    }
  });

  it('扫码枪自带回车 / 首尾空白被清洗', () => {
    const result = validateScanInput('  WO-20261009-001\r\n');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('WO-20261009-001');
  });

  it('SQL 注入特征被拒绝', () => {
    for (const raw of [
      "'; DROP TABLE work_order; --",
      'WO-1\' OR \'1\'=\'1',
      '101 UNION SELECT password_hash FROM sys_user',
      '1=1',
    ]) {
      const result = validateScanInput(raw);
      expect(result.ok, raw).toBe(false);
      expect(result.normalized).toBeNull();
      expect(result.reason).toBeTruthy();
    }
  });

  it('URL / 连接串被拒绝', () => {
    for (const raw of [
      'https://evil.example.com/steal?token=',
      'mysql://root:password@127.0.0.1:3306/smart_mes',
      '//evil.example.com',
    ]) {
      const result = validateScanInput(raw);
      expect(result.ok, raw).toBe(false);
      expect(result.reason).toContain('不安全');
    }
  });

  it('空内容与超长内容被拒绝', () => {
    expect(validateScanInput('').ok).toBe(false);
    expect(validateScanInput('   ').ok).toBe(false);
    expect(validateScanInput('A'.repeat(65)).ok).toBe(false);
    expect(validateScanInput('A'.repeat(64)).ok).toBe(true);
  });

  it('非字符串输入被拒绝', () => {
    expect(validateScanInput(undefined as unknown as string).ok).toBe(false);
    expect(validateScanInput(42 as unknown as string).ok).toBe(false);
  });
});
