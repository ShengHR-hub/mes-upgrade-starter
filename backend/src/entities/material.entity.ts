import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 物料主数据（`material`，24 行，来源 06_物料清单.xlsx）。
 *
 * B5（S10）启用：`GET /materials` 只读列表、`PATCH /materials/{code}` 仅可改安全库存。
 * 不新增物料创建/删除（主数据维护不在本版契约内）。
 *
 * `safety_stock` 仅作记录；**没有可用库存流水，安全库存不触发任何自动预警**
 * （契约 §10.1）。
 */
@Entity('material')
export class Material {
  @PrimaryColumn({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 64 })
  name!: string;

  @Column({ name: 'spec', type: 'varchar', length: 128, nullable: true })
  spec!: string | null;

  @Column({ name: 'category', type: 'varchar', length: 32, nullable: true })
  category!: string | null;

  @Column({ name: 'unit', type: 'varchar', length: 8, nullable: true })
  unit!: string | null;

  @Column({ name: 'safety_stock', type: 'int', default: 0 })
  safetyStock!: number;

  @Column({ name: 'supplier', type: 'varchar', length: 64, nullable: true })
  supplier!: string | null;

  @Column({ name: 'remark', type: 'varchar', length: 128, nullable: true })
  remark!: string | null;
}
