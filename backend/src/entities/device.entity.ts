import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 设备主数据（`device`，13 行，来源 02_设备清单.xlsx）。
 *
 * S5 只做**只读存在性校验**（任务 `device_code` 无 SQL 外键，服务端必须自行校验），
 * 设备状态机、OEE、状态日志属 B7 → S10。
 *
 * ⚠️ 不依据 `process_route.key_device` 的描述自动分配设备（契约 §6.3）。
 */
@Entity('device')
export class Device {
  @PrimaryColumn({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 64 })
  name!: string;

  @Column({ name: 'workshop', type: 'varchar', length: 32 })
  workshop!: string;

  @Column({ name: 'prod_line', type: 'varchar', length: 32, nullable: true })
  prodLine!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: '运行中' })
  status!: string;

  @Column({ name: 'purchase_year', type: 'year', nullable: true })
  purchaseYear!: number | null;

  @Column({ name: 'supplier', type: 'varchar', length: 64, nullable: true })
  supplier!: string | null;

  @Column({ name: 'remark', type: 'varchar', length: 128, nullable: true })
  remark!: string | null;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true, insert: false, update: false })
  updatedAt!: Date | null;
}
