import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DEMO_SOURCE_META } from '../../common/constants/data-source.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { isValidDecimalId } from '../../common/utils/id.util.js';
import { invalidArgument } from '../../common/utils/validation.util.js';

import { formatScaledDecimal, multiplyQty, parseDecimalToScaled } from './decimal.util.js';
import type { MaterialRequirementCalculationDto } from './dto/material-requirement-calculation.dto.js';
import { MAX_ORDER_IDS } from './dto/material-requirement-calculation.dto.js';

export interface MaterialRequirementItemResponse {
  materialCode: string;
  /** 毛需求（order.qty × bom.qty 的精确十进制字符串，2 位小数） */
  grossRequiredQty: string;
  /** 累计入库数量（material_batch.qty 之和）——**不等于可用库存** */
  inboundQty: number;
  /** 无出库/占用/调整/在途流水 → 恒为 null（契约 §6.10） */
  availableQty: null;
  shortageQty: null;
  purchaseSuggestionQty: null;
}

export interface MaterialRequirementCalculationResponse {
  orderIds: string[];
  items: MaterialRequirementItemResponse[];
  calculationScope: 'flat-bom-gross-requirements';
  limitations: string[];
  snapshotAt: string;
  dataSource: string;
  dataLabel: string;
}

/** 计算范围标识（契约 §6.10 响应示例） */
export const CALCULATION_SCOPE = 'flat-bom-gross-requirements';

/** 能力限制说明（任务书 B12 要求 7：明确说明不能计算真实净缺口和采购量） */
export const MRP_LIMITATIONS: readonly string[] = Object.freeze([
  '仅按「订单数量 × BOM 单位用量」汇总平面毛需求，不做多层 BOM 递归展开。',
  '现有表没有出库、占用、调整与采购在途流水，不能计算真实净缺口与采购量：availableQty / shortageQty / purchaseSuggestionQty 恒为 null。',
  'inboundQty 仅为物料批次的累计入库数量，不等于可用库存，不得据此推导缺料。',
  '不含损耗率、替代料与在产扣减；结果为查询时刻的快照，不持久化采购单。',
]);

interface OrderRow {
  id: string;
  code: string;
  product_code: string;
  qty: number;
}

interface BomRow {
  product_code: string;
  material_code: string;
  qty: string;
}

interface InboundRow {
  material_code: string;
  total_qty: unknown;
}

/**
 * B12 MRP-lite 服务 —— 契约 §6.10（受限）。
 *
 * 铁律：
 * - 只计算 `order.qty × bom.qty` 的平面毛需求；
 * - 缺 BOM 返回 30005（MISSING_PREREQUISITE），**不能**当作「无需物料」；
 * - availableQty / shortageQty / purchaseSuggestionQty 恒为 null；
 * - 只读快照，不写任何业务数据（无采购持久化、无审计写入）。
 */
@Injectable()
export class MaterialRequirementsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async calculate(
    dto: MaterialRequirementCalculationDto,
    snapshotAt: string,
  ): Promise<MaterialRequirementCalculationResponse> {
    // ---- 参数校验（任务书 B12 要求 1：非空、去重、上限 100）----
    if (!Array.isArray(dto.orderIds) || dto.orderIds.length === 0) {
      throw invalidArgument({ field: 'orderIds', reason: 'orderIds 不能为空' });
    }
    if (dto.orderIds.length > MAX_ORDER_IDS) {
      throw invalidArgument({ field: 'orderIds', reason: `orderIds 最多 ${MAX_ORDER_IDS} 个` });
    }
    if (new Set(dto.orderIds).size !== dto.orderIds.length) {
      throw invalidArgument({ field: 'orderIds', reason: 'orderIds 存在重复项，必须去重' });
    }
    for (const id of dto.orderIds) {
      if (!isValidDecimalId(id)) {
        throw invalidArgument({ field: 'orderIds', reason: 'orderIds 每项必须为正整数且不超过 BIGINT 上限' });
      }
    }

    const result = await this.readConsistently(async (executor) => {
      // ---- 订单必须真实存在（任务书 B12 要求 2）----
      const placeholders = dto.orderIds.map(() => '?').join(', ');
      const orderRows = (await executor.query(
        `SELECT id, code, product_code, qty FROM sale_order WHERE id IN (${placeholders}) ORDER BY id ASC`,
        dto.orderIds,
      )) as OrderRow[];
      const foundIds = new Set(orderRows.map((row) => String(row.id)));
      const missing = dto.orderIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BusinessException(
          ErrorCode.RESOURCE_NOT_FOUND,
          `订单不存在：${missing.join(', ')}`,
        );
      }

      // ---- BOM：产品去重后逐产品读取；缺 BOM → 30005（不能当作无需物料）----
      const productCodes = [...new Set(orderRows.map((row) => String(row.product_code)))];
      const bomRows: BomRow[] = [];
      for (const productCode of productCodes) {
        const rows = (await executor.query(
          'SELECT product_code, material_code, qty FROM bom WHERE product_code = ? ORDER BY id ASC',
          [productCode],
        )) as BomRow[];
        if (rows.length === 0) {
          throw new BusinessException(
            ErrorCode.MISSING_PREREQUISITE,
            `产品 ${productCode} 没有 BOM 明细，无法计算毛需求（30005：不是「无需物料」）`,
          );
        }
        bomRows.push(...rows);
      }

      // ---- 累计入库数量（仅信息展示，不等于可用库存）----
      const materialCodes = [...new Set(bomRows.map((row) => String(row.material_code)))];
      const inboundPlaceholders = materialCodes.map(() => '?').join(', ');
      const inboundRows = (await executor.query(
        `SELECT material_code, COALESCE(SUM(qty), 0) AS total_qty
         FROM material_batch WHERE material_code IN (${inboundPlaceholders}) GROUP BY material_code`,
        materialCodes,
      )) as InboundRow[];
      const inboundMap = new Map<string, number>();
      for (const row of inboundRows) {
        inboundMap.set(String(row.material_code), Number(row.total_qty ?? 0));
      }

      return { orderRows, bomRows, inboundMap };
    });

    // ---- 毛需求聚合：每个订单逐条乘加，BigInt 精确运算 ----
    const bomsByProduct = new Map<string, BomRow[]>();
    for (const row of result.bomRows) {
      const key = String(row.product_code);
      if (!bomsByProduct.has(key)) bomsByProduct.set(key, []);
      bomsByProduct.get(key)!.push(row);
    }

    const grossByMaterial = new Map<string, bigint>();
    for (const order of result.orderRows) {
      const boms = bomsByProduct.get(String(order.product_code)) ?? [];
      for (const bom of boms) {
        const materialCode = String(bom.material_code);
        const current = grossByMaterial.get(materialCode) ?? 0n;
        grossByMaterial.set(
          materialCode,
          current + multiplyQty(Number(order.qty), parseDecimalToScaled(bom.qty)),
        );
      }
    }

    const items: MaterialRequirementItemResponse[] = [...grossByMaterial.entries()]
      .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
      .map(([materialCode, scaled]) => ({
        materialCode,
        grossRequiredQty: formatScaledDecimal(scaled),
        inboundQty: result.inboundMap.get(materialCode) ?? 0,
        availableQty: null,
        shortageQty: null,
        purchaseSuggestionQty: null,
      }));

    return {
      orderIds: dto.orderIds,
      items,
      calculationScope: CALCULATION_SCOPE,
      limitations: [...MRP_LIMITATIONS],
      snapshotAt,
      ...DEMO_SOURCE_META,
    };
  }

  /** 一致性读（REPEATABLE READ 事务；与 B8/B11 同一执行器模式） */
  private async readConsistently<T>(run: (executor: DataSource) => Promise<T>): Promise<T> {
    const ds = this.dataSource as unknown as {
      transaction?: (...args: unknown[]) => Promise<T>;
    };
    if (typeof ds?.transaction === 'function') {
      if (ds.transaction.length === 1) {
        return ds.transaction(run as never);
      }
      return ds.transaction('REPEATABLE READ', run as never);
    }
    return run(this.dataSource);
  }
}
