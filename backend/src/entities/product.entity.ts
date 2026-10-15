import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 产品主数据（`product`，15 行，来源 01_产品清单.xlsx）。
 *
 * 只读映射：S5 仅用于校验订单 `productCode` 存在性与产品选择，
 * **不提供任何写入**。主键是字符串 `code`（契约 §2.1）。
 */
@Entity('product')
export class Product {
  @PrimaryColumn({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 64 })
  name!: string;

  @Column({ name: 'line', type: 'varchar', length: 32 })
  line!: string;

  @Column({ name: 'monthly_output', type: 'int', default: 0 })
  monthlyOutput!: number;

  @Column({ name: 'unit', type: 'varchar', length: 8, nullable: true, default: '片' })
  unit!: string | null;

  @Column({ name: 'std_hours', type: 'decimal', precision: 6, scale: 2, nullable: true, default: 0 })
  stdHours!: string | null;

  @Column({ name: 'remark', type: 'varchar', length: 128, nullable: true })
  remark!: string | null;

  /** DB 默认 CURRENT_TIMESTAMP，应用侧永不写入 */
  @Column({ name: 'created_at', type: 'timestamp', nullable: true, insert: false, update: false })
  createdAt!: Date | null;
}
