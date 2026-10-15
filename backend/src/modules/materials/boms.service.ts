import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { ENTERPRISE_MASTER_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { page as buildPage } from '../../common/dto/api-response.js';
import { normalizePagination } from '../../common/dto/pagination.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { lockProductRow } from '../../common/utils/product-lock.util.js';
import { isDuplicateKeyError } from '../../common/utils/validation.util.js';
import { AuditService } from '../audit/audit.service.js';

import type { CreateBomDto } from './dto/create-bom.dto.js';
import type { BomResponse } from './dto/bom-response.js';
import type { UpdateBomDto } from './dto/update-bom.dto.js';

interface BomRow {
  id: string;
  product_code: string;
  level: number;
  material_code: string;
  qty: string;
  unit: string | null;
}

const BOM_COLUMNS = [
  'b.id AS id',
  'b.product_code AS product_code',
  'b.level AS level',
  'b.material_code AS material_code',
  // DECIMAL 一律以字符串返回（契约 §2.1），保持精确十进制
  'CAST(b.qty AS CHAR) AS qty',
  'b.unit AS unit',
].join(', ');

function assertPositiveQty(qty: string): void {
  if (!(Number(qty) > 0)) {
    throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
      errors: [{ field: 'qty', reason: 'qty 必须大于 0' }],
    });
  }
}

/**
 * B5 产品 BOM 服务 —— 契约 §6.6。
 *
 * 硬约束：
 * - `qty` 精确十进制字符串，`qty > 0`、`level ≥ 1`；同产品/物料不重复（唯一键 + 服务端查重）；
 * - **引用保护**：产品存在关联已确认订单或工单时，PATCH/DELETE 一律 30004
 *   （避免无版本 BOM 改写已确认订单的计算依据）；
 * - 增删改与审计**同一事务**；ER_DUP_ENTRY(1062) 转 30002，不透传 500。
 *
 * 并发正确性（S10 复审 P2 修复 · 第二轮）：
 * 仅锁 `bom` 行**不足以**保证引用保护 —— 订单确认事务锁的是 `sale_order` 行，
 * 两者无共同资源，可能在「BOM 判定无已确认业务」与「订单确认提交」之间交错。
 *
 * 第一版曾用会话级命名锁（`GET_LOCK`）串行化，但它在事务回调的 `finally` 中提前释放，
 * **未覆盖事务提交点**，竞态依旧（复审 P2 第二轮）。
 * 现改为：**所有** BOM 写事务（create/update/remove）与 `OrdersService.confirm`
 * 共同锁定同一 `product` 行（`SELECT code FROM product WHERE code = ? FOR UPDATE`，
 * 见 `common/utils/product-lock.util.ts`）。InnoDB 行锁在**事务提交时**才释放，
 * 因此后到者阻塞到先到者**提交完成**，随后读到的必是已提交数据。
 *
 * ⚠️ 关键顺序约束：产品行锁必须是事务内**第一条语句**（锁定读不建立快照，
 * 从而保证其后的引用判定是「第一次一致性读」，快照建立于取锁之后）。
 * `update`/`remove` 因此把 `product_code` 的定位查询放在**事务外**。
 */
@Injectable()
export class BomsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/v1/products/{code}/boms —— BOM 列表（按 id 升序） */
  async listByProduct(productCode: string, query: { page?: string; pageSize?: string }) {
    const pagination = normalizePagination(query);

    if (!(await this.productExists(productCode))) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `产品不存在：${productCode}`);
    }

    const countRows = (await this.dataSource.query(
      'SELECT COUNT(*) AS total FROM bom WHERE product_code = ?',
      [productCode],
    )) as Array<{ total: string | number }>;

    const rows = (await this.dataSource.query(
      `SELECT ${BOM_COLUMNS} FROM bom b WHERE b.product_code = ? ORDER BY b.id ASC LIMIT ? OFFSET ?`,
      [productCode, pagination.take, pagination.skip],
    )) as BomRow[];

    return buildPage(
      rows.map((row) => this.toResponse(row)),
      Number(countRows[0]?.total ?? 0),
      pagination.page,
      pagination.pageSize,
    );
  }

  /** POST /api/v1/products/{code}/boms —— 新增 BOM 行 */
  async create(
    productCode: string,
    dto: CreateBomDto,
    context: { userId: string; ip: string | null },
  ): Promise<BomResponse> {
    assertPositiveQty(dto.qty);

    return this.dataSource.transaction(async (manager) => {
      // ① 产品行锁必须是**事务内第一条语句**：锁定读不建立快照，
      //    从而保证其后的引用判定是「第一次一致性读」，快照建立于取锁（竞争者已提交）之后。
      //    同时承担产品存在性校验（不存在 → 30001）。
      await lockProductRow(manager, productCode);

      const materials = (await manager.query('SELECT code FROM material WHERE code = ?', [
        dto.materialCode,
      ])) as Array<{ code: string }>;
      if (materials.length === 0) {
        throw new BusinessException(ErrorCode.INVALID_REFERENCE, `物料不存在：${dto.materialCode}`);
      }

      // 引用保护对新增同样适用：产品已进入确认/生产时不得追加改变计算依据的行
      if (await this.hasConfirmedBusiness(manager, productCode)) {
        throw new BusinessException(
          ErrorCode.REFERENCE_IN_USE,
          `产品 ${productCode} 已存在关联的已确认订单或工单，为保护在产计算依据，BOM 不可新增`,
        );
      }

      const duplicated = (await manager.query(
        'SELECT id FROM bom WHERE product_code = ? AND material_code = ?',
        [productCode, dto.materialCode],
      )) as Array<{ id: string }>;
      if (duplicated.length > 0) {
        throw new BusinessException(
          ErrorCode.RESOURCE_CONFLICT,
          `该产品已存在物料「${dto.materialCode}」的 BOM 行`,
        );
      }

      let insertId: string;
      try {
        const result = (await manager.query(
          [
            'INSERT INTO bom (product_code, level, material_code, qty, unit)',
            'VALUES (?, ?, ?, ?, ?)',
          ].join(' '),
          [productCode, dto.level, dto.materialCode, dto.qty, dto.unit ?? null],
        )) as { insertId: string | number };
        insertId = String(result.insertId);
      } catch (error) {
        // 并发下同一产品/物料同时插入：唯一键冲突转 30002（S5 教训）
        if (isDuplicateKeyError(error)) {
          throw new BusinessException(
            ErrorCode.RESOURCE_CONFLICT,
            `该产品已存在物料「${dto.materialCode}」的 BOM 行`,
          );
        }
        throw error;
      }

      await this.audit.write(manager, {
        userId: context.userId,
        action: '新增BOM',
        target: `bom:${insertId}`,
        detail: `产品 ${productCode} 新增物料 ${dto.materialCode}，level ${dto.level}，qty ${dto.qty}`,
        ip: context.ip,
      });

      const rows = (await manager.query(`SELECT ${BOM_COLUMNS} FROM bom b WHERE b.id = ?`, [
        insertId,
      ])) as BomRow[];
      return this.toResponse(rows[0]);
    });
  }

  /** PATCH /api/v1/boms/{id} —— 修改 level/qty/unit（受引用保护） */
  async update(
    id: string,
    dto: UpdateBomDto,
    context: { userId: string; ip: string | null },
  ): Promise<BomResponse> {
    if (!isValidDecimalId(id)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'id', reason: 'BOM ID 必须为正整数且不超过 BIGINT 上限' }],
      });
    }
    if (dto.qty !== undefined) assertPositiveQty(dto.qty);

    // 至少一个可改字段（unit:null 视为显式清空，计入"有修改"）
    const hasChange = dto.level !== undefined || dto.qty !== undefined || dto.unit !== undefined;
    if (!hasChange) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'body', reason: '至少提供一个待修改字段（level / qty / unit）' }],
      });
    }

    // 定位 product_code（**事务外**普通读）：保证产品行锁是事务内第一条语句，
    // 从而其后的引用判定是「第一次一致性读」，快照建立于取锁之后。
    // product_code 不可变（PATCH 仅允许 level/qty/unit），事务外读取安全。
    const productCode = await this.locateProductCode(id);

    return this.dataSource.transaction(async (manager) => {
      // ① 产品行锁（事务内第一条语句）：与订单确认共用同一互斥协议，覆盖事务提交点
      await lockProductRow(manager, productCode);

      // ② 锁内读取待改 BOM 行（产品行锁已串行化同产品的所有 BOM 写）
      const rows = (await manager.query(
        `SELECT ${BOM_COLUMNS} FROM bom b WHERE b.id = ? FOR UPDATE`,
        [id],
      )) as BomRow[];
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `BOM 不存在：${id}`);
      }
      const current = rows[0];

      // ③ 引用判定：产品行锁已到手（并发的确认事务已提交），此处读到的是已提交数据
      if (await this.hasConfirmedBusiness(manager, current.product_code)) {
        throw new BusinessException(
          ErrorCode.REFERENCE_IN_USE,
          `产品 ${current.product_code} 已存在关联的已确认订单或工单，为保护在产计算依据，BOM 不可修改`,
        );
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (dto.level !== undefined) {
        sets.push('level = ?');
        params.push(dto.level);
      }
      if (dto.qty !== undefined) {
        sets.push('qty = ?');
        params.push(dto.qty);
      }
      if (dto.unit !== undefined) {
        sets.push('unit = ?');
        params.push(dto.unit);
      }
      params.push(id);
      await manager.query(`UPDATE bom SET ${sets.join(', ')} WHERE id = ?`, params);

      await this.audit.write(manager, {
        userId: context.userId,
        action: '修改BOM',
        target: `bom:${id}`,
        detail: `BOM ${id}（产品 ${current.product_code} 物料 ${current.material_code}）已修改`,
        ip: context.ip,
      });

      const updated = (await manager.query(`SELECT ${BOM_COLUMNS} FROM bom b WHERE b.id = ?`, [
        id,
      ])) as BomRow[];
      return this.toResponse(updated[0]);
    });
  }

  /** DELETE /api/v1/boms/{id} —— 删除 BOM 行（受引用保护；返回 data:null） */
  async remove(id: string, context: { userId: string; ip: string | null }): Promise<null> {
    if (!isValidDecimalId(id)) {
      throw new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
        errors: [{ field: 'id', reason: 'BOM ID 必须为正整数且不超过 BIGINT 上限' }],
      });
    }

    // 同 update：事务外定位 product_code，保证产品行锁是事务内第一条语句
    const productCode = await this.locateProductCode(id);

    return this.dataSource.transaction(async (manager) => {
      // ① 产品行锁（事务内第一条语句）
      await lockProductRow(manager, productCode);

      // ② 锁内读取待删 BOM 行
      const rows = (await manager.query(
        `SELECT ${BOM_COLUMNS} FROM bom b WHERE b.id = ? FOR UPDATE`,
        [id],
      )) as BomRow[];
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `BOM 不存在：${id}`);
      }
      const current = rows[0];

      // ③ 引用判定（锁内、快照建立于取锁之后 → 读到已提交数据）
      if (await this.hasConfirmedBusiness(manager, current.product_code)) {
        throw new BusinessException(
          ErrorCode.REFERENCE_IN_USE,
          `产品 ${current.product_code} 已存在关联的已确认订单或工单，为保护在产计算依据，BOM 不可删除`,
        );
      }

      await manager.query('DELETE FROM bom WHERE id = ?', [id]);

      await this.audit.write(manager, {
        userId: context.userId,
        action: '删除BOM',
        target: `bom:${id}`,
        detail: `BOM ${id}（产品 ${current.product_code} 物料 ${current.material_code}）已删除`,
        ip: context.ip,
      });

      return null;
    });
  }

  /**
   * 事务外定位 BOM 行所属产品编号（普通读、无锁）。
   *
   * 目的：让 `lockProductRow` 能作为**事务内第一条语句**执行
   * （锁定读不建立一致性读快照，避免引用判定读到过期快照）。
   * `bom.product_code` 不可变（PATCH 仅允许 level/qty/unit），故事务外读取是安全的；
   * 行是否仍存在由事务内的 `FOR UPDATE` 复读兜底。
   */
  private async locateProductCode(id: string): Promise<string> {
    const rows = (await this.dataSource.query('SELECT product_code FROM bom WHERE id = ?', [
      id,
    ])) as Array<{ product_code: string }>;
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, `BOM 不存在：${id}`);
    }
    return rows[0]!.product_code;
  }

  private async productExists(productCode: string): Promise<boolean> {
    const rows = (await this.dataSource.query('SELECT code FROM product WHERE code = ?', [
      productCode,
    ])) as Array<{ code: string }>;
    return rows.length > 0;
  }

  /**
   * 引用保护判据（契约 §6.6「有关联已确认订单或工单」）：
   * - 任一**非待确认**销售订单（即已进入确认/生产/完成/延期），或
   * - 任一工单（工单只可能由订单确认产生）
   * 关联到该产品，即视为在产计算依据已存在。
   */
  private async hasConfirmedBusiness(
    manager: EntityManager,
    productCode: string,
  ): Promise<boolean> {
    const orders = (await manager.query(
      'SELECT id FROM sale_order WHERE product_code = ? AND status <> ? LIMIT 1',
      [productCode, '待确认'],
    )) as Array<{ id: string }>;
    if (orders.length > 0) return true;

    const workOrders = (await manager.query(
      'SELECT id FROM work_order WHERE product_code = ? LIMIT 1',
      [productCode],
    )) as Array<{ id: string }>;
    return workOrders.length > 0;
  }

  private toResponse(row: BomRow): BomResponse {
    return {
      id: String(row.id),
      productCode: row.product_code,
      level: Number(row.level),
      materialCode: row.material_code,
      qty: row.qty,
      unit: row.unit,
      ...ENTERPRISE_MASTER_SOURCE_META,
    };
  }
}
