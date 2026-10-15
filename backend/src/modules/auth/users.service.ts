import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { escapeLikePattern, isDuplicateKeyError } from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';

import type {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto.js';
import type { UserResponse } from './dto/user-response.js';
import { PasswordService } from './password.service.js';

interface UserRow {
  id: string;
  username: string;
  name: string;
  dept: string | null;
  post: string | null;
  role: string;
  phone: string | null;
  enabled: number;
}

/**
 * 用户管理服务 —— 契约 §5.3（仅 admin）。
 *
 * 硬约束：
 * - **最后一个启用 admin 不得停用或降级**：事务内对目标行 `FOR UPDATE`，
 *   再对全部启用 admin 行 `FOR UPDATE` 复核数量，并发操作被串行化，无法绕过；
 * - 不提供为他人重置密码的入口（AUTH-3：账号重置另行授权）；
 * - `password_hash` 只在创建用户时写入，任何查询/响应都不带出；
 * - 新建用户与审计同事务；username 唯一冲突 → 30002。
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/v1/users —— 用户列表（admin） */
  async list(query: ListUsersQueryDto): Promise<PageResult<UserResponse>> {
    const pagination = normalizePagination(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.role !== undefined) {
      conditions.push('u.role = ?');
      params.push(query.role);
    }
    if (query.enabled !== undefined) {
      conditions.push('u.enabled = ?');
      params.push(query.enabled ? 1 : 0);
    }
    if (query.keyword !== undefined) {
      conditions.push("(u.username LIKE ? ESCAPE '\\\\' OR u.name LIKE ? ESCAPE '\\\\')");
      const pattern = `%${escapeLikePattern(query.keyword)}%`;
      params.push(pattern, pattern);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM sys_user u ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT u.id AS id, u.username AS username, u.name AS name, u.dept AS dept,',
        'u.post AS post, u.role AS role, u.phone AS phone, u.enabled AS enabled',
        `FROM sys_user u ${whereSql} ORDER BY u.id ASC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as UserRow[];

    return buildPage(
      rows.map((row) => this.toResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** POST /api/v1/users —— 新建用户（admin；Argon2id 哈希；201 由控制器声明） */
  async create(dto: CreateUserDto, context: { userId: string; ip: string | null }): Promise<UserResponse> {
    const passwordHash = await this.passwords.hashPassword(dto.password);

    return this.dataSource.transaction(async (manager) => {
      const duplicated = (await manager.query('SELECT id FROM sys_user WHERE username = ?', [
        dto.username,
      ])) as Array<{ id: string }>;
      if (duplicated.length > 0) {
        throw new BusinessException(ErrorCode.RESOURCE_CONFLICT, `用户名已存在：${dto.username}`);
      }

      let insertId: string;
      try {
        const result = (await manager.query(
          [
            'INSERT INTO sys_user (username, name, dept, post, role, phone, password_hash, enabled)',
            'VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
          ].join(' '),
          [
            dto.username,
            dto.name,
            dto.dept ?? null,
            dto.post ?? null,
            dto.role,
            dto.phone ?? null,
            passwordHash,
          ],
        )) as { insertId: string | number };
        insertId = String(result.insertId);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new BusinessException(ErrorCode.RESOURCE_CONFLICT, `用户名已存在：${dto.username}`);
        }
        throw error;
      }

      await this.audit.write(manager, {
        userId: context.userId,
        action: '新建用户',
        target: `sys_user:${insertId}`,
        detail: `新建用户 ${dto.username}，角色 ${dto.role}`,
        ip: context.ip,
      });

      const rows = (await manager.query(
        [
          'SELECT u.id AS id, u.username AS username, u.name AS name, u.dept AS dept,',
          'u.post AS post, u.role AS role, u.phone AS phone, u.enabled AS enabled',
          'FROM sys_user u WHERE u.id = ?',
        ].join(' '),
        [insertId],
      )) as UserRow[];
      return this.toResponse(rows[0]);
    });
  }

  /** PATCH /api/v1/users/{id} —— 修改用户资料/角色/启用状态（admin） */
  async update(
    id: string,
    dto: UpdateUserDto,
    context: { userId: string; ip: string | null },
  ): Promise<UserResponse> {
    const hasChange =
      dto.name !== undefined ||
      dto.dept !== undefined ||
      dto.post !== undefined ||
      dto.phone !== undefined ||
      dto.role !== undefined ||
      dto.enabled !== undefined;
    if (!hasChange) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [
          {
            field: 'body',
            reason: '至少提供一个待修改字段（name / dept / post / phone / role / enabled）',
          },
        ],
      });
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. 锁目标行
      const rows = (await manager.query(
        [
          'SELECT u.id AS id, u.username AS username, u.name AS name, u.dept AS dept,',
          'u.post AS post, u.role AS role, u.phone AS phone, u.enabled AS enabled',
          'FROM sys_user u WHERE u.id = ? FOR UPDATE',
        ].join(' '),
        [id],
      )) as UserRow[];
      const current = rows[0];
      if (!current) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `用户不存在：${id}`);
      }

      const nextRole = dto.role ?? current.role;
      const nextEnabled = dto.enabled ?? Number(current.enabled) === 1;

      // 2. 最后一个启用 admin 保护（并发安全）：
      //    若本次变更会使「启用 admin」集合失去 current，则锁定全部启用 admin 行，
      //    确认除 current 外没有其他启用 admin，否则 30002。
      const removesLastAdmin =
        current.role === 'admin' &&
        Number(current.enabled) === 1 &&
        !(nextRole === 'admin' && nextEnabled);
      if (removesLastAdmin) {
        const otherAdmins = (await manager.query(
          "SELECT id FROM sys_user WHERE role = 'admin' AND enabled = 1 AND id <> ? FOR UPDATE",
          [id],
        )) as Array<{ id: string }>;
        if (otherAdmins.length === 0) {
          throw new BusinessException(
            ErrorCode.RESOURCE_CONFLICT,
            '系统中必须至少保留一个启用的管理员账号，禁止停用或降级最后一个管理员',
          );
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (dto.name !== undefined) {
        sets.push('name = ?');
        params.push(dto.name);
      }
      if (dto.dept !== undefined) {
        sets.push('dept = ?');
        params.push(dto.dept);
      }
      if (dto.post !== undefined) {
        sets.push('post = ?');
        params.push(dto.post);
      }
      if (dto.phone !== undefined) {
        sets.push('phone = ?');
        params.push(dto.phone);
      }
      if (dto.role !== undefined) {
        sets.push('role = ?');
        params.push(dto.role);
      }
      if (dto.enabled !== undefined) {
        sets.push('enabled = ?');
        params.push(dto.enabled ? 1 : 0);
      }
      params.push(id);
      await manager.query(`UPDATE sys_user SET ${sets.join(', ')} WHERE id = ?`, params);

      await this.audit.write(manager, {
        userId: context.userId,
        action: '修改用户',
        target: `sys_user:${id}`,
        detail: `用户 ${current.username} 资料已修改`,
        ip: context.ip,
      });

      const updated = (await manager.query(
        [
          'SELECT u.id AS id, u.username AS username, u.name AS name, u.dept AS dept,',
          'u.post AS post, u.role AS role, u.phone AS phone, u.enabled AS enabled',
          'FROM sys_user u WHERE u.id = ?',
        ].join(' '),
        [id],
      )) as UserRow[];
      return this.toResponse(updated[0]);
    });
  }

  private toResponse(row: UserRow): UserResponse {
    return {
      id: String(row.id),
      username: row.username,
      name: row.name,
      dept: row.dept,
      post: row.post,
      role: row.role as UserResponse['role'],
      phone: row.phone,
      enabled: Number(row.enabled) === 1,
    };
  }
}
