import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { isValidDateOnly, nextDayDateOnly } from '../../common/utils/date-only.util.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { escapeLikePattern } from '../../common/utils/validation.util.js';

import { DEVICE_STATUS_VALUES } from './dto/list-devices-query.dto.js';
import type {
  DeviceOeeResponse,
  DeviceResponse,
  DeviceStateLogResponse,
} from './dto/device-response.js';
import { OEE_MISSING_INPUTS } from './dto/device-response.js';

interface DeviceRow {
  code: string;
  name: string;
  workshop: string;
  prod_line: string | null;
  status: string;
  purchase_year: number | null;
  supplier: string | null;
  remark: string | null;
  updated_at: Date | null;
}

interface StateLogRow {
  id: string;
  device_code: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  remark: string | null;
  changed_at: Date | null;
}

/**
 * Q3 已批准的允许流转表。
 *
 * ⚠️ **当前为空**：契约 §10.2「设备允许流转表、停机超时阈值」仍是 Q3 待确认项，
 * 用户尚未批准任何迁移。因此在批准前：
 * - 不编造阈值、不允许任意跳转；
 * - `POST /devices/{code}/state-transitions` 对**任何** targetStatus 返回
 *   30006 CAPABILITY_UNAVAILABLE（不做 device / equipment_log 写入）；
 * - Q3 批准后只需在本表补充允许集合与阈值，控制器/守卫/DTO 零改动。
 */
export const ALLOWED_DEVICE_TRANSITIONS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({});

/** 演示固定约束（契约 §6.7）：EQP-SMT-006 保持「维修中 / 加热区故障」 */
export const DEMO_FIXED_DEVICE_CODE = 'EQP-SMT-006';
export const DEMO_FIXED_DEVICE_STATUS = '维修中';

/**
 * B7 设备管理服务 —— 契约 §6.7。
 *
 * - 列表/详情：主数据 + 状态（演示口径标识）；
 * - 状态日志：仅读；只由（当前关闭的）状态变更接口写，不伪造过去时间；
 * - OEE：缺输入时返回 null + insufficient_data + missingInputs，不编造数字；
 * - 状态迁移：入口注册但**写入保持关闭**（Q3 未批准），expectedStatus 仍严格校验，
 *   并发冲突返回 30003 而不是覆盖新状态。
 */
@Injectable()
export class DevicesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** GET /api/v1/devices —— 设备列表 */
  async list(query: {
    workshop?: string;
    prodLine?: string;
    status?: string;
    keyword?: string;
    page?: string;
    pageSize?: string;
  }): Promise<PageResult<DeviceResponse>> {
    const pagination = normalizePagination(query);

    if (query.status !== undefined && !DEVICE_STATUS_VALUES.includes(query.status as never)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [
          { field: 'status', reason: `status 必须为 ${DEVICE_STATUS_VALUES.join(' / ')} 之一` },
        ],
      });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.workshop !== undefined) {
      conditions.push('d.workshop = ?');
      params.push(query.workshop);
    }
    if (query.prodLine !== undefined) {
      conditions.push('d.prod_line = ?');
      params.push(query.prodLine);
    }
    if (query.status !== undefined) {
      conditions.push('d.status = ?');
      params.push(query.status);
    }
    if (query.keyword !== undefined) {
      conditions.push("(d.code LIKE ? ESCAPE '\\\\' OR d.name LIKE ? ESCAPE '\\\\')");
      const pattern = `%${escapeLikePattern(query.keyword)}%`;
      params.push(pattern, pattern);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM device d ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT d.code AS code, d.name AS name, d.workshop AS workshop, d.prod_line AS prod_line,',
        'd.status AS status, d.purchase_year AS purchase_year, d.supplier AS supplier,',
        'd.remark AS remark, d.updated_at AS updated_at',
        `FROM device d ${whereSql} ORDER BY d.code ASC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as DeviceRow[];

    return buildPage(
      rows.map((row) => this.toDeviceResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** GET /api/v1/devices/{code} —— 设备详情 */
  async detail(code: string): Promise<DeviceResponse> {
    const rows = (await this.dataSource.query(
      [
        'SELECT d.code AS code, d.name AS name, d.workshop AS workshop, d.prod_line AS prod_line,',
        'd.status AS status, d.purchase_year AS purchase_year, d.supplier AS supplier,',
        'd.remark AS remark, d.updated_at AS updated_at FROM device d WHERE d.code = ?',
      ].join(' '),
      [code],
    )) as DeviceRow[];
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `设备不存在：${code}`);
    }
    return this.toDeviceResponse(rows[0]);
  }

  /**
   * GET /api/v1/devices/{code}/state-logs —— 状态日志（按时间倒序、ID 倒序稳定分页）。
   *
   * 半开区间：结束日 + 1 天 00:00，与 S7 历史查询统一口径，防边界漏算。
   */
  async listStateLogs(
    code: string,
    query: { startDate?: string; endDate?: string; page?: string; pageSize?: string },
  ): Promise<PageResult<DeviceStateLogResponse>> {
    const pagination = normalizePagination(query);

    if (!(await this.deviceExists(code))) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `设备不存在：${code}`);
    }
    if (query.startDate !== undefined && !isValidDateOnly(query.startDate)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'startDate', reason: '必须为真实存在的日期 YYYY-MM-DD' }],
      });
    }
    if (query.endDate !== undefined && !isValidDateOnly(query.endDate)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'endDate', reason: '必须为真实存在的日期 YYYY-MM-DD' }],
      });
    }

    const conditions = ['el.device_code = ?'];
    const params: unknown[] = [code];
    if (query.startDate !== undefined) {
      conditions.push('el.changed_at >= ?');
      params.push(query.startDate);
    }
    if (query.endDate !== undefined) {
      conditions.push('el.changed_at < ?');
      params.push(nextDayDateOnly(query.endDate));
    }
    const whereSql = `WHERE ${conditions.join(' AND ')}`;

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM equipment_log el ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT el.id AS id, el.device_code AS device_code, el.old_status AS old_status,',
        'el.new_status AS new_status, el.changed_by AS changed_by, el.remark AS remark,',
        'el.changed_at AS changed_at',
        `FROM equipment_log el ${whereSql} ORDER BY el.changed_at DESC, el.id DESC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as StateLogRow[];

    return buildPage(
      rows.map((row) => this.toLogResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /**
   * GET /api/v1/devices/{code}/oee-analyses —— OEE 查询。
   *
   * Q3 验收口径：只有状态变更日志不够；缺计划生产时间、设备产出归属、理想节拍时
   * 返回 null + insufficient_data + missingInputs（不用随机数/默认值冒充）。
   * 本版 OEE 三项输入全部缺失，因此恒定返回 insufficient_data。
   */
  async oee(code: string): Promise<DeviceOeeResponse> {
    if (!(await this.deviceExists(code))) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `设备不存在：${code}`);
    }
    return {
      deviceCode: code,
      availability: null,
      performance: null,
      quality: null,
      oee: null,
      calculationStatus: 'insufficient_data',
      missingInputs: [...OEE_MISSING_INPUTS],
      ...DEMO_SOURCE_META,
    };
  }

  /**
   * POST /api/v1/devices/{code}/state-transitions —— 状态迁移（**写入入口保持关闭**）。
   *
   * Q3 未批准任何允许流转与停机超时阈值，因此：
   * 1. 校验 expectedStatus 与当前状态一致（并发冲突 → 30003，不覆盖新状态）；
   * 2. 查 `ALLOWED_DEVICE_TRANSITIONS`（当前为空）→ 一律 30006，**不写 device、
   *    不写 equipment_log、不写自动停机告警**；
   * 3. 事务内不产生任何写入：失败即回滚，操作人/时间仍以服务端为准的逻辑保留，
   *    Q3 批准后按 S5 同款步骤补齐（FOR UPDATE → 更新 device → 插 log → 审计）。
   */
  async transition(
    code: string,
    expectedStatus: string,
    targetStatus: string,
  ): Promise<never> {
    if (!DEVICE_STATUS_VALUES.includes(targetStatus as never)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [
          { field: 'targetStatus', reason: `targetStatus 必须为 ${DEVICE_STATUS_VALUES.join(' / ')} 之一` },
        ],
      });
    }

    return this.dataSource.transaction(async (manager) => {
      // 行锁读取当前状态：校验 expectedStatus，防止覆盖别人刚改的新状态
      const rows = (await manager.query(
        'SELECT code, status FROM device WHERE code = ? FOR UPDATE',
        [code],
      )) as Array<{ code: string; status: string }>;
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `设备不存在：${code}`);
      }
      if (rows[0].status !== expectedStatus) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `设备当前状态为「${rows[0].status}」，与 expectedStatus「${expectedStatus}」不一致`,
        );
      }

      const allowed = ALLOWED_DEVICE_TRANSITIONS[expectedStatus] ?? [];
      if (!allowed.includes(targetStatus)) {
        throw new BusinessException(
          ErrorCode.CAPABILITY_UNAVAILABLE,
          '设备允许状态迁移与停机超时阈值待 Q3 确认，本版未开放任何状态流转；不变更设备状态、不写状态日志、不启用自动停机告警。',
        );
      }

      // 不可达：allowed 为空表。Q3 批准后在此处补齐写入（更新 device → 插 equipment_log → 审计）。
      throw new BusinessException(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        '设备允许状态迁移待 Q3 确认，本版未开放。',
      );
    });
  }

  private async deviceExists(code: string): Promise<boolean> {
    const rows = (await this.dataSource.query('SELECT code FROM device WHERE code = ?', [
      code,
    ])) as Array<{ code: string }>;
    return rows.length > 0;
  }

  private toDeviceResponse(row: DeviceRow): DeviceResponse {
    return {
      code: row.code,
      name: row.name,
      workshop: row.workshop,
      prodLine: row.prod_line,
      status: row.status,
      purchaseYear: row.purchase_year,
      supplier: row.supplier,
      remark: row.remark,
      updatedAt: row.updated_at === null ? null : toShanghaiRfc3339(row.updated_at),
      // 契约 §6.1：主数据为企业来源，当前状态与演示固定约束属演示口径
      dataSource: 'enterprise-master',
      statusDataSource: 'demo',
      dataLabel: '演示数据',
    };
  }

  private toLogResponse(row: StateLogRow): DeviceStateLogResponse {
    return {
      id: String(row.id),
      deviceCode: row.device_code,
      oldStatus: row.old_status,
      newStatus: row.new_status,
      changedBy: row.changed_by === null ? null : String(row.changed_by),
      remark: row.remark,
      changedAt: row.changed_at === null ? null : row.changed_at.toISOString(),
      ...DEMO_SOURCE_META,
    };
  }
}
