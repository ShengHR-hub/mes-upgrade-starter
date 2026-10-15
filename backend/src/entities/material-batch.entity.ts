import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 物料批次（`material_batch`）。
 *
 * B5（S10）启用：`batch_no` 唯一（SQL 有唯一约束，服务端仍先行校验并转 30002）；
 * `qty` 仅表示**入库数量**，不是可用库存（契约 §6.6）。
 * 本版没有出库/占用/调整 API，不得由累计入库推导真实缺料。
 */
@Entity('material_batch')
export class MaterialBatch {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'batch_no', type: 'varchar', length: 64 })
  batchNo!: string;

  @Column({ name: 'material_code', type: 'varchar', length: 32 })
  materialCode!: string;

  @Column({ name: 'qty', type: 'int' })
  qty!: number;

  @Column({ name: 'inbound_at', type: 'date' })
  inboundAt!: string;

  @Column({ name: 'supplier', type: 'varchar', length: 64, nullable: true })
  supplier!: string | null;
}
