import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ENTERPRISE_MASTER_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { escapeLikePattern } from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';

import type { ListMaterialsQueryDto } from './dto/list-materials-query.dto.js';
import type { MaterialResponse } from './dto/material-response.js';
import type { UpdateMaterialDto } from './dto/update-material.dto.js';

interface MaterialRow {
  code: string;
  name: string;
  spec: string | null;
  category: string | null;
  unit: string | null;
  safety_stock: number;
  supplier: string | null;
  remark: string | null;
}

/**
 * B5 物料主数据服务 —— 契约 §6.6。
 *
 * - `GET /materials`：只读列表（企业主数据来源标识，不带 dataLabel）；
 * - `PATCH /materials/{code}`：**只能**改安全库存，且与审计同事务；
 * - 不新增/删除物料（主数据维护不在本版契约内）。
 */
@Injectable()
export class MaterialsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListMaterialsQueryDto): Promise<PageResult<MaterialResponse>> {
    const pagination = normalizePagination(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.keyword !== undefined) {
      conditions.push("(m.code LIKE ? ESCAPE '\\\\' OR m.name LIKE ? ESCAPE '\\\\')");
      const pattern = `%${escapeLikePattern(query.keyword)}%`;
      params.push(pattern, pattern);
    }
    if (query.category !== undefined) {
      conditions.push('m.category = ?');
      params.push(query.category);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM material m ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT m.code AS code, m.name AS name, m.spec AS spec, m.category AS category,',
        'm.unit AS unit, m.safety_stock AS safety_stock, m.supplier AS supplier,',
        `m.remark AS remark FROM material m ${whereSql} ORDER BY m.code ASC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as MaterialRow[];

    return buildPage(
      rows.map((row) => this.toResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** PATCH /api/v1/materials/{code} —— 仅安全库存；与审计同一事务 */
  async updateSafetyStock(
    code: string,
    dto: UpdateMaterialDto,
    context: { userId: string; ip: string | null },
  ): Promise<MaterialResponse> {
    return this.dataSource.transaction(async (manager) => {
      // 行锁：与并发修改/审计保持同一事务边界
      const rows = (await manager.query(
        'SELECT code, name, spec, category, unit, safety_stock, supplier, remark FROM material WHERE code = ? FOR UPDATE',
        [code],
      )) as MaterialRow[];
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `物料不存在：${code}`);
      }

      await manager.query('UPDATE material SET safety_stock = ? WHERE code = ?', [
        dto.safetyStock,
        code,
      ]);

      await this.audit.write(manager, {
        userId: context.userId,
        action: '修改物料安全库存',
        target: `material:${code}`,
        detail: `物料 ${code} 安全库存由 ${rows[0].safety_stock} 调整为 ${dto.safetyStock}`,
        ip: context.ip,
      });

      const updated = (await manager.query(
        'SELECT code, name, spec, category, unit, safety_stock, supplier, remark FROM material WHERE code = ?',
        [code],
      )) as MaterialRow[];

      return this.toResponse(updated[0]);
    });
  }

  private toResponse(row: MaterialRow): MaterialResponse {
    return {
      code: row.code,
      name: row.name,
      spec: row.spec,
      category: row.category,
      unit: row.unit,
      safetyStock: Number(row.safety_stock),
      supplier: row.supplier,
      remark: row.remark,
      ...ENTERPRISE_MASTER_SOURCE_META,
    };
  }
}
