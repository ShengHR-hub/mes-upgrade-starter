import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { isValidDateOnly, nextDayDateOnly } from '../../common/utils/date-only.util.js';
import { toShanghaiRfc3339 } from '../../common/utils/datetime.util.js';
import { ROLES, type Role } from '../../common/auth/identity.types.js';
import { PERMISSION_MATRIX, permissionsOf } from '../../common/auth/permission-matrix.js';

import type {
  ListAiQueryLogsQueryDto,
  ListAuditLogsQueryDto,
} from './dto/list-logs-query.dto.js';
import type {
  AiQueryLogResponse,
  AuditLogResponse,
  RolePermissionsResponse,
} from './dto/log-responses.js';

interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  created_at: Date | null;
}

interface AiQueryLogRow {
  id: string;
  user_id: string | null;
  kind: string;
  question: string;
  sql_generated: string | null;
  answer: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  status: string;
  created_at: Date | null;
}

/** 日期复核：query 字符串已过 DTO 格式校验，这里校验真实日历日 */
function assertDates(query: { startDate?: string; endDate?: string }): void {
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
}

/**
 * 只读日志与权限清单服务 —— 契约 §5.3（仅 admin）。
 *
 * - 日志**只读**：不提供任何修改/删除接口；
 * - 日期过滤闭区间转半开区间（结束日 + 1 天 00:00），与 S7 历史口径一致；
 * - 分页按时间倒序、ID 倒序稳定分页（契约 §2.1）。
 */
@Injectable()
export class LogsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** GET /api/v1/audit-logs —— 操作审计日志（只读） */
  async listAuditLogs(query: ListAuditLogsQueryDto): Promise<PageResult<AuditLogResponse>> {
    const pagination = normalizePagination(query);
    assertDates(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.userId !== undefined) {
      conditions.push('a.user_id = ?');
      params.push(query.userId);
    }
    if (query.action !== undefined) {
      conditions.push('a.action = ?');
      params.push(query.action);
    }
    if (query.startDate !== undefined) {
      conditions.push('a.created_at >= ?');
      params.push(query.startDate);
    }
    if (query.endDate !== undefined) {
      conditions.push('a.created_at < ?');
      params.push(nextDayDateOnly(query.endDate));
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM audit_log a ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT a.id AS id, a.user_id AS user_id, a.action AS action, a.target AS target,',
        'a.detail AS detail, a.ip AS ip, a.created_at AS created_at',
        `FROM audit_log a ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as AuditLogRow[];

    return buildPage(
      rows.map((row) => ({
        id: String(row.id),
        userId: row.user_id === null ? null : String(row.user_id),
        action: row.action,
        target: row.target,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.created_at === null ? null : toShanghaiRfc3339(row.created_at),
      })),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** GET /api/v1/ai-query-logs —— AI 查询日志（只读；sql_generated 恒为 null 的形状保留） */
  async listAiQueryLogs(query: ListAiQueryLogsQueryDto): Promise<PageResult<AiQueryLogResponse>> {
    const pagination = normalizePagination(query);
    assertDates(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.userId !== undefined) {
      conditions.push('q.user_id = ?');
      params.push(query.userId);
    }
    if (query.kind !== undefined) {
      conditions.push('q.kind = ?');
      params.push(query.kind);
    }
    if (query.status !== undefined) {
      conditions.push('q.status = ?');
      params.push(query.status);
    }
    if (query.startDate !== undefined) {
      conditions.push('q.created_at >= ?');
      params.push(query.startDate);
    }
    if (query.endDate !== undefined) {
      conditions.push('q.created_at < ?');
      params.push(nextDayDateOnly(query.endDate));
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM ai_query_log q ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT q.id AS id, q.user_id AS user_id, q.kind AS kind, q.question AS question,',
        'q.sql_generated AS sql_generated, q.answer AS answer, q.tokens_in AS tokens_in,',
        'q.tokens_out AS tokens_out, q.latency_ms AS latency_ms, q.status AS status,',
        'q.created_at AS created_at',
        `FROM ai_query_log q ${whereSql} ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as AiQueryLogRow[];

    return buildPage(
      rows.map((row) => ({
        id: String(row.id),
        userId: row.user_id === null ? null : String(row.user_id),
        kind: row.kind,
        question: row.question,
        sqlGenerated: row.sql_generated,
        answer: row.answer,
        tokensIn: Number(row.tokens_in),
        tokensOut: Number(row.tokens_out),
        latencyMs: Number(row.latency_ms),
        status: row.status,
        createdAt: row.created_at === null ? null : toShanghaiRfc3339(row.created_at),
      })),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** GET /api/v1/role-permissions —— 三角色权限清单（完整返回） */
  rolePermissions(): RolePermissionsResponse {
    return {
      roles: ROLES.map((role: Role) => ({
        role,
        permissions: permissionsOf(role).filter((key) => PERMISSION_MATRIX[key].length > 0),
      })),
    };
  }
}
