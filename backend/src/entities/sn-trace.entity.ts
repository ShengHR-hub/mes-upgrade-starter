import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * SN 追溯（`sn_trace`）。
 *
 * B6（S10）启用。硬约束（契约 §6.6）：
 * - `sn` 唯一；一个 SN 仅有一个当前快照及一个批次；
 * - `product_code` 从工单读取、`operator_id` 取服务端可信身份（不接受客户端指定）；
 * - `task_id` 必须属于对应工单；`device_code` / `batch_id` 必须存在；
 * - PATCH 不修改 `produced_at`，不伪造过去事件；
 * - `qc_result` 只是快照字段，不证明与某张 qc_record 逐件绑定；
 * - 工单工序/检验仅展示为**关联上下文**，不是该 SN 已证实的逐工序历史。
 */
@Entity('sn_trace')
export class SnTrace {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'sn', type: 'varchar', length: 64, unique: true })
  sn!: string;

  @Column({ name: 'work_order_id', type: 'bigint' })
  workOrderId!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 32 })
  productCode!: string;

  @Column({ name: 'task_id', type: 'bigint', nullable: true })
  taskId!: string | null;

  @Column({ name: 'operator_id', type: 'bigint', nullable: true })
  operatorId!: string | null;

  @Column({ name: 'device_code', type: 'varchar', length: 32, nullable: true })
  deviceCode!: string | null;

  @Column({ name: 'batch_id', type: 'bigint', nullable: true })
  batchId!: string | null;

  @Column({ name: 'qc_result', type: 'varchar', length: 8, nullable: true })
  qcResult!: string | null;

  @Column({ name: 'produced_at', type: 'timestamp', nullable: true, insert: false, update: false })
  producedAt!: Date | null;
}
