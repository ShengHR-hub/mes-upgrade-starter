import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 生产工单（`work_order`）—— B2。
 *
 * 状态枚举：`待启动/在产/暂停/完工/关闭`。
 * 本版**只启用需求已确定的主线** `待启动 → 在产 → 完工`；
 * 暂停/恢复/关闭属 Q2 未决，相关流转一律返回 `30006` 并标明阻塞原因。
 *
 * `plan_start` / `plan_end` 为 DATE（契约 §6.8 日计划分摊使用 DATE 口径）。
 */
@Entity('work_order')
export class WorkOrder {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'sale_order_id', type: 'bigint', nullable: true })
  saleOrderId!: string | null;

  @Column({ name: 'product_code', type: 'varchar', length: 32 })
  productCode!: string;

  @Column({ name: 'qty', type: 'int' })
  qty!: number;

  @Column({ name: 'done_qty', type: 'int', default: 0 })
  doneQty!: number;

  @Column({ name: 'status', type: 'varchar', length: 16, default: '待启动' })
  status!: string;

  @Column({ name: 'plan_start', type: 'date', nullable: true })
  planStart!: string | null;

  @Column({ name: 'plan_end', type: 'date', nullable: true })
  planEnd!: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, insert: false, update: false })
  createdAt!: Date | null;
}
