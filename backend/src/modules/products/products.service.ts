import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ENTERPRISE_MASTER_SOURCE_META } from '../../common/constants/data-source.js';
import { page as buildPage, type PageResult } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { escapeLikePattern } from '../../common/utils/validation.util.js';

import type { ListProductsQueryDto } from './dto/list-products-query.dto.js';
import type { ProductResponse } from './dto/product-response.js';

interface ProductRow {
  code: string;
  name: string;
  line: string;
  monthly_output: string | number;
  unit: string | null;
  std_hours: string | null;
  remark: string | null;
}

/**
 * 产品主数据只读服务（契约 §6.6）。
 *
 * ⚠️ 依赖范围（S5 明确声明）：**仅为 B1 订单提供产品选择与存在性校验所需的最小只读能力**，
 * 不实现 B5 的 BOM / 工艺路线 / 物料 / 批次，也不提供任何写入。
 *
 * 数据来源为企业真实主数据，因此响应标 `dataSource:"enterprise-master"` 且**不带 `dataLabel`**。
 */
@Injectable()
export class ProductsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(query: ListProductsQueryDto): Promise<PageResult<ProductResponse>> {
    const pagination = normalizePagination(query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.keyword !== undefined) {
      conditions.push("(p.code LIKE ? ESCAPE '\\\\' OR p.name LIKE ? ESCAPE '\\\\')");
      const pattern = `%${escapeLikePattern(query.keyword)}%`;
      params.push(pattern, pattern);
    }
    if (query.line !== undefined) {
      conditions.push('p.line = ?');
      params.push(query.line);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM product p ${whereSql}`,
      params,
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      [
        'SELECT p.code AS code, p.name AS name, p.line AS line,',
        'p.monthly_output AS monthly_output, p.unit AS unit,',
        // DECIMAL 一律以字符串返回（契约 §2.1），避免浮点表示差异
        'CAST(p.std_hours AS CHAR) AS std_hours, p.remark AS remark',
        `FROM product p ${whereSql} ORDER BY p.code ASC LIMIT ? OFFSET ?`,
      ].join(' '),
      [...params, pagination.take, pagination.skip],
    )) as ProductRow[];

    return buildPage(
      rows.map((row) => this.toResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  private toResponse(row: ProductRow): ProductResponse {
    return {
      code: row.code,
      name: row.name,
      line: row.line,
      monthlyOutput: Number(row.monthly_output),
      unit: row.unit,
      stdHours: row.std_hours,
      remark: row.remark,
      ...ENTERPRISE_MASTER_SOURCE_META,
    };
  }
}
