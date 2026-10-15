import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 操作审计日志（`audit_log`）—— 契约 §5.3。
 *
 * ⚠️ 审计必须与业务事务**同事务提交或回滚**（任务书 §二.9）；
 * `user_id` 取服务端可信身份，**不接受客户端指定**。
 *
 * ⚠️ 审计内容不得包含密码、完整 JWT、AI Key（契约 §5.1）。
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId!: string | null;

  @Column({ name: 'action', type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'target', type: 'varchar', length: 128, nullable: true })
  target!: string | null;

  @Column({ name: 'detail', type: 'text', nullable: true })
  detail!: string | null;

  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, insert: false, update: false })
  createdAt!: Date | null;
}
