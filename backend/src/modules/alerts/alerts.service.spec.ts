import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AlertsService } from './alerts.service.js';

describe('AlertsService (契约 §6.9 / B10 预警中心)', () => {
  it('list 列表查询：稳定倒序分页，支持过滤与时区格式化', async () => {
    const customQuery = async (sql: string, _params: unknown[] = []) => {
      if (sql.includes('SELECT COUNT(*) AS total FROM alert')) {
        return [{ total: 1 }];
      }
      if (sql.includes('FROM alert a')) {
        return [
          {
            id: '801',
            level: '重要',
            type: '质量异常',
            title: 'SMT-3良品率低于97%',
            content: '演示报工良品率95.00%，不等同于真实FPY',
            ref_type: null,
            ref_id: null,
            status: '未处理',
            created_at_epoch: 1791507600, // 2026-10-09 09:00:00+08:00
          },
        ];
      }
      return [];
    };

    const mockDataSource = { query: vi.fn(customQuery) } as any;
    const mockAudit = { write: vi.fn() } as any;
    const mockMetrics = {} as any;

    const service = new AlertsService(mockDataSource, mockAudit, mockMetrics);

    const res = await service.list({
      type: '质量异常',
      level: '重要',
      status: '未处理',
      startDate: '2026-10-09',
      endDate: '2026-10-09',
      page: 1,
      pageSize: 20,
    });

    expect(res.total).toBe(1);
    expect(res.list).toHaveLength(1);
    expect(res.list[0]).toMatchObject({
      id: '801',
      level: '重要',
      type: '质量异常',
      title: 'SMT-3良品率低于97%',
      content: '演示报工良品率95.00%，不等同于真实FPY',
      status: '未处理',
      dataSource: 'demo',
      dataLabel: '演示数据',
    });
    expect(res.list[0].createdAt).toBe('2026-10-09T09:00:00.000+08:00');
  });

  it('list 日期校验：startDate 晚于 endDate 抛 10001 INVALID_ARGUMENT', async () => {
    const service = new AlertsService({} as any, {} as any, {} as any);
    await expect(
      service.list({ startDate: '2026-10-10', endDate: '2026-10-09' }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('getById 详情查询：存在时返回完整 DTO，不存在时抛 30001 RESOURCE_NOT_FOUND', async () => {
    const customQuery = async (sql: string, params: unknown[] = []) => {
      if (params[0] === '801') {
        return [
          {
            id: '801',
            level: '重要',
            type: '质量异常',
            title: 'SMT-3良品率低于97%',
            content: '演示内容',
            ref_type: null,
            ref_id: null,
            status: '未处理',
            created_at_epoch: 1791507600,
          },
        ];
      }
      return [];
    };

    const service = new AlertsService({ query: vi.fn(customQuery) } as any, {} as any, {} as any);

    const item = await service.getById('801');
    expect(item.id).toBe('801');
    expect(item.title).toBe('SMT-3良品率低于97%');

    await expect(service.getById('99999')).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });

  describe('transitionState 预警状态流转', () => {
    it('Q6 未批准时，流转请求一律拒绝 30006 且不调用 UPDATE', async () => {
      const mockManager = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT id, status FROM alert')) {
            return [{ id: '801', status: '未处理' }];
          }
          return [];
        }),
      };

      const mockDataSource = {
        transaction: vi.fn(async (cb: (m: any) => Promise<any>) => cb(mockManager)),
      } as any;

      const mockAudit = {
        write: vi.fn(async () => undefined),
      };

      const service = new AlertsService(mockDataSource, mockAudit as any, {} as any);

      await expect(
        service.transitionState(
          '801',
          { expectedStatus: '未处理', targetStatus: '已确认' },
          { userId: '1', ip: '127.0.0.1' },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAPABILITY_UNAVAILABLE,
      });

      expect(mockManager.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
      expect(mockAudit.write).not.toHaveBeenCalled();
    });

    it('id 非法十进制正整数时抛 10001 INVALID_ARGUMENT', async () => {
      const service = new AlertsService({} as any, {} as any, {} as any);
      await expect(
        service.transitionState(
          '-1',
          { expectedStatus: '未处理', targetStatus: '已确认' },
          { userId: '1', ip: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    });
  });

  describe('analyzeRootCause 根因分析 (F4 / 契约 §6.9)', () => {
    const mockUser = { id: '1', role: 'admin', username: 'admin' } as any;

    it('id 非法十进制正整数时抛 10001 INVALID_ARGUMENT', async () => {
      const service = new AlertsService({} as any, {} as any, {} as any);
      await expect(service.analyzeRootCause('invalid', mockUser)).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
      });
    });

    it('预警不存在时抛 30001 RESOURCE_NOT_FOUND', async () => {
      const mockDataSource = {
        query: vi.fn(async () => []),
      };
      const service = new AlertsService(mockDataSource as any, {} as any, {} as any);
      await expect(service.analyzeRootCause('99999', mockUser)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('正常调用：收集同线设备证据，严格校验 evidenceRefs 引用，记录 ai_query_log', async () => {
      const mockDataSource = {
        query: vi.fn(async (sql: string, _params: unknown[] = []) => {
          if (sql.includes('FROM alert a') && sql.includes('WHERE a.id = ?')) {
            return [
              {
                id: '801',
                level: '重要',
                type: '质量异常',
                title: 'SMT-3产线良品率低于97%',
                content: 'EQP-SMT-006 状态异常',
                ref_type: null,
                ref_id: null,
                status: '未处理',
                created_at_epoch: 1791507600,
              },
            ];
          }
          if (sql.includes('FROM device WHERE code = ?')) {
            return [
              {
                code: 'EQP-SMT-006',
                name: '回流焊炉',
                workshop: 'SMT车间',
                prod_line: 'SMT-3',
                status: '维修中',
                remark: '温区故障',
              },
            ];
          }
          if (sql.includes('FROM equipment_log WHERE device_code = ?')) {
            return [
              {
                id: 1,
                device_code: 'EQP-SMT-006',
                old_status: '运行中',
                new_status: '维修中',
                remark: '温区故障',
              },
            ];
          }
          return [];
        }),
      };

      const mockAiProxy = {
        callRootCauseAnalyses: vi.fn(async (req) => {
          expect(req.evidence).toHaveLength(2);
          expect(req.evidence[0].ref).toBe('device:EQP-SMT-006');
          return {
            possibleCauses: [
              {
                text: '设备 EQP-SMT-006 维修中，可能影响焊接质量。',
                evidenceRefs: ['device:EQP-SMT-006', 'device:HALLUCINATED'], // 包含不存在的引用
              },
            ],
            suggestion: '请设备负责人核查回流焊炉。',
            analysisStatus: 'hypothesis',
            explanation: null,
            mode: 'local',
            degraded: false,
            usage: { tokensIn: 10, tokensOut: 10 },
            latencyMs: 12,
          };
        }),
        logAiQuery: vi.fn(),
      };

      const service = new AlertsService(
        mockDataSource as any,
        {} as any,
        {} as any,
        mockAiProxy as any,
      );

      const res = await service.analyzeRootCause('801', mockUser);

      expect(res.alertId).toBe('801');
      expect(res.analysisStatus).toBe('hypothesis');
      expect(res.possibleCauses).toHaveLength(1);
      // 幻觉引用被安全过滤，只保留实际证据中的 ref
      expect(res.possibleCauses[0].evidenceRefs).toEqual(['device:EQP-SMT-006']);
      expect(res.suggestion).toBe('请设备负责人核查回流焊炉。');
      expect(mockAiProxy.logAiQuery).toHaveBeenCalledTimes(1);
      expect(mockAiProxy.logAiQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'root_cause',
          userId: '1',
          status: '成功',
        }),
      );
    });

    it('P2 整改：全部引用均不存在时，删除该原因并返回 insufficient_evidence', async () => {
      const mockDataSource = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM alert a') && sql.includes('WHERE a.id = ?')) {
            return [
              {
                id: 802,
                level: '一般',
                type: '质量异常',
                title: '外观微瑕',
                content: '工单 WO-202610-001 出现微瑕',
                ref_type: 'work_order',
                ref_id: 101,
                status: '未处理',
                created_at_epoch: 1760000000,
              },
            ];
          }
          if (sql.includes('FROM qc_record q')) {
            return [
              {
                qc_id: 1,
                result: 'NG',
                check_qty: 10,
                ng_qty: 1,
                checked_at: '2026-10-09 10:00:00',
                defect_id: 11,
                defect_type: '微小划伤',
                defect_qty: 1,
                step_name: '外观检验',
              },
            ];
          }
          return [];
        }),
      };

      const mockAiProxy = {
        callRootCauseAnalyses: vi.fn(async () => ({
          possibleCauses: [
            {
              text: '虚构原因：无依据设备故障。',
              evidenceRefs: ['device:HALLUCINATED_999'], // 全部不存在
            },
          ],
          suggestion: '虚构建议。',
          analysisStatus: 'hypothesis',
          explanation: null,
          mode: 'local',
          degraded: false,
          usage: { tokensIn: 5, tokensOut: 5 },
          latencyMs: 10,
        })),
        logAiQuery: vi.fn(),
      };

      const service = new AlertsService(
        mockDataSource as any,
        {} as any,
        {} as any,
        mockAiProxy as any,
      );

      const res = await service.analyzeRootCause('802', mockUser);
      // 全部引用不存在的原因被删除，由于失去了全部有效原因，状态变为 insufficient_evidence
      expect(res.possibleCauses).toEqual([]);
      expect(res.analysisStatus).toBe('insufficient_evidence');
      expect(res.explanation).toContain('已过滤无依据原因');
      expect(res.suggestion).toContain('建议先补充关联证据');
    });

    it('P2 整改：下游调用抛错失败时，记录 status: 失败 的审计日志并向上抛出异常', async () => {
      const mockDataSource = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM alert a') && sql.includes('WHERE a.id = ?')) {
            return [
              {
                id: 803,
                level: '重要',
                type: '设备停机',
                title: '贴片机故障',
                content: 'EQP-SMT-003 故障',
                status: '未处理',
                created_at_epoch: 1760000000,
              },
            ];
          }
          return [];
        }),
      };

      const mockAiProxy = {
        callRootCauseAnalyses: vi.fn(async () => {
          throw new BusinessException(ErrorCode.DEPENDENCY_UNAVAILABLE, 'AI 服务挂了');
        }),
        logAiQuery: vi.fn(),
      };

      const service = new AlertsService(
        mockDataSource as any,
        {} as any,
        {} as any,
        mockAiProxy as any,
      );

      await expect(service.analyzeRootCause('803', mockUser)).rejects.toMatchObject({
        code: ErrorCode.DEPENDENCY_UNAVAILABLE,
      });

      expect(mockAiProxy.logAiQuery).toHaveBeenCalledTimes(1);
      expect(mockAiProxy.logAiQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'root_cause',
          userId: '1',
          status: '失败',
        }),
      );
    });

    it('P2 整改：产线标识完整匹配支持 SMT-2线 与 SMT-2，且证据遵守截止时间', async () => {
      let queriedProdLines: any[] = [];
      let queriedCutoff: any = null;

      const mockDataSource = {
        query: vi.fn(async (sql: string, params: any[]) => {
          if (sql.includes('FROM alert a') && sql.includes('WHERE a.id = ?')) {
            return [
              {
                id: 804,
                level: '重要',
                type: '质量异常',
                title: 'SMT-2线不良率偏高',
                content: '产线：SMT-2线 设备 EQP-SMT-006 回流焊不良',
                status: '未处理',
                created_at_epoch: 1760000000,
              },
            ];
          }
          if (sql.includes('FROM device WHERE prod_line IN (?, ?)')) {
            queriedProdLines = params;
            return [
              {
                code: 'EQP-SMT-006',
                name: '回流焊炉',
                prod_line: 'SMT-2线',
                status: '维修中',
                remark: '加热区故障',
              },
            ];
          }
          if (sql.includes('FROM equipment_log') && sql.includes('changed_at <= ?')) {
            queriedCutoff = params[1];
            return [];
          }
          return [];
        }),
      };

      const service = new AlertsService(
        mockDataSource as any,
        {} as any,
        {} as any,
        undefined, // 本地替身模式
      );

      const res = await service.analyzeRootCause('804', mockUser);
      expect(queriedProdLines).toEqual(['SMT-2线', 'SMT-2']);
      expect(queriedCutoff).toBeDefined();
      expect(typeof queriedCutoff).toBe('string');
      expect(res.possibleCauses).toHaveLength(1);
      expect(res.possibleCauses[0].text).toContain('同线设备 EQP-SMT-006');
    });

    it('P2 整改：FastAPI 正常返回 no_anomaly 时，保留未见异常状态与维持监控建议，不得误改为证据不足', async () => {
      const mockDataSource = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM alert a') && sql.includes('WHERE a.id = ?')) {
            return [
              {
                id: 805,
                level: '一般',
                type: '质量异常',
                title: '外观微瑕抽检',
                content: '常规巡检',
                status: '未处理',
                created_at_epoch: 1760000000,
              },
            ];
          }
          return [];
        }),
      };

      const mockAiProxy = {
        callRootCauseAnalyses: vi.fn(async () => ({
          possibleCauses: [],
          suggestion: '建议维持当前运行参数并持续监控。',
          analysisStatus: 'no_anomaly',
          explanation: '证据显示相关对象运行正常，未发现异常，无可分析的根因。',
          mode: 'local',
          degraded: false,
          usage: { tokensIn: 5, tokensOut: 5 },
          latencyMs: 8,
        })),
        logAiQuery: vi.fn(),
      };

      const service = new AlertsService(
        mockDataSource as any,
        {} as any,
        {} as any,
        mockAiProxy as any,
      );

      const res = await service.analyzeRootCause('805', mockUser);
      expect(res.possibleCauses).toEqual([]);
      expect(res.analysisStatus).toBe('no_anomaly');
      expect(res.explanation).toBe('证据显示相关对象运行正常，未发现异常，无可分析的根因。');
      expect(res.suggestion).toBe('建议维持当前运行参数并持续监控。');
    });
  });
});

