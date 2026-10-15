import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 工艺路线（`process_route`）。
 *
 * ⚠️ 重要口径（`docs/handovers/s1-db.md` §6.4、契约 §10）：
 * 表内共 10 行，**全部属于 `JC-PLC-2001`**，即只有该产品有可拆解的工序明细；
 * 其余产品「有路线总览」不等于「有可拆解工序」，确认工单时须返回 `30005`。
 *
 * 只读映射：S5 仅用于订单确认时复制工序为任务，**不提供任何写入**。
 */
@Entity('process_route')
export class ProcessRoute {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 32 })
  productCode!: string;

  @Column({ name: 'seq', type: 'int' })
  seq!: number;

  @Column({ name: 'step_name', type: 'varchar', length: 32 })
  stepName!: string;

  @Column({ name: 'workshop', type: 'varchar', length: 32, nullable: true })
  workshop!: string | null;

  @Column({ name: 'prod_line', type: 'varchar', length: 32, nullable: true })
  prodLine!: string | null;

  @Column({ name: 'std_minutes', type: 'decimal', precision: 8, scale: 2, nullable: true, default: 0 })
  stdMinutes!: string | null;

  /** VARCHAR(64) 描述字段，**不保证**是 `device.code`，不得当外键使用（契约 §6.3） */
  @Column({ name: 'key_device', type: 'varchar', length: 64, nullable: true })
  keyDevice!: string | null;

  @Column({ name: 'qc_point', type: 'varchar', length: 128, nullable: true })
  qcPoint!: string | null;
}
