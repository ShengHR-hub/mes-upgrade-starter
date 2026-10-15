import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 产品 BOM（`bom`，2 个产品共 28 行物料行，不含成品行）。
 *
 * B5（S10）启用。硬约束（契约 §6.6）：
 * - `qty` 为 DECIMAL(10,2)，**一律以精确十进制字符串**读写（契约 §2.1）；
 * - `(product_code, material_code)` 有唯一键 `uk_bom`，同一产品/物料不得重复；
 * - `level` 不是父子关联，禁止据此推断多层 BOM 树；
 * - 产品存在关联**已确认订单或工单**时，修改/删除返回 30004（REFERENCE_IN_USE），
 *   避免无版本 BOM 改写已确认订单的计算依据。
 */
@Entity('bom')
export class Bom {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 32 })
  productCode!: string;

  @Column({ name: 'level', type: 'int', default: 1 })
  level!: number;

  @Column({ name: 'material_code', type: 'varchar', length: 32 })
  materialCode!: string;

  @Column({ name: 'qty', type: 'decimal', precision: 10, scale: 2 })
  qty!: string;

  @Column({ name: 'unit', type: 'varchar', length: 8, nullable: true })
  unit!: string | null;
}
