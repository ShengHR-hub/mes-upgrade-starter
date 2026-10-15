import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 销售订单（`sale_order`）—— B1。
 *
 * 状态列 `status` 只存生命周期原值（`待确认` / `已确认`）；
 * `生产中` / `已完成` / `已延期` 由查询时按契约 §6.2 派生（见 `orders/order-status.ts`），
 * 不写回数据库。
 */
@Entity('sale_order')
export class SaleOrder {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 32 })
  productCode!: string;

  @Column({ name: 'qty', type: 'int' })
  qty!: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: '待确认' })
  status!: string;

  /** 创建人 —— 取服务端可信身份，**不接受客户端指定**（任务书 §二.9） */
  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, insert: false, update: false })
  createdAt!: Date | null;
}
