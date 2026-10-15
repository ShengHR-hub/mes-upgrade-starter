import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 工序任务（`work_task`）—— B2。
 *
 * 状态枚举：`待启动/在产/完工`（主线 `待启动 → 在产 → 完工`）。
 *
 * ⚠️ `plan_start` / `plan_end` 是 **DATETIME**（与工单的 DATE 计划不同，契约 §6.8 明确
 * 「日分摊用 work_order 的 DATE 计划，不用任务 DATETIME 计划替代」）。
 *
 * ⚠️ `device_code` / `operator_id` 在 SQL 中**没有外键**，服务端必须自行校验存在性
 * （契约 §10.2 补充说明）。
 */
@Entity('work_task')
export class WorkTask {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'work_order_id', type: 'bigint' })
  workOrderId!: string;

  @Column({ name: 'seq', type: 'int' })
  seq!: number;

  @Column({ name: 'step_name', type: 'varchar', length: 32 })
  stepName!: string;

  @Column({ name: 'workshop', type: 'varchar', length: 32, nullable: true })
  workshop!: string | null;

  @Column({ name: 'prod_line', type: 'varchar', length: 32, nullable: true })
  prodLine!: string | null;

  @Column({ name: 'device_code', type: 'varchar', length: 32, nullable: true })
  deviceCode!: string | null;

  @Column({ name: 'operator_id', type: 'bigint', nullable: true })
  operatorId!: string | null;

  @Column({ name: 'plan_qty', type: 'int', default: 0 })
  planQty!: number;

  @Column({ name: 'good_qty', type: 'int', default: 0 })
  goodQty!: number;

  @Column({ name: 'bad_qty', type: 'int', default: 0 })
  badQty!: number;

  @Column({ name: 'status', type: 'varchar', length: 16, default: '待启动' })
  status!: string;

  @Column({ name: 'plan_start', type: 'datetime', nullable: true })
  planStart!: Date | null;

  @Column({ name: 'plan_end', type: 'datetime', nullable: true })
  planEnd!: Date | null;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt!: Date | null;
}
