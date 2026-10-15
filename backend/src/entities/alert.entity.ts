import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 预警记录实体（`alert` 表，契约 §6.1 / §6.9）。
 *
 * 字段约束：
 * - `level`: VARCHAR(8) '紧急' | '重要' | '一般'
 * - `type`: VARCHAR(32) '质量异常' | '延期风险' | '设备停机' ...
 * - `title`: VARCHAR(128)
 * - `content`: VARCHAR(512)
 * - `ref_type`: VARCHAR(32) 可为空，如 'work_order'
 * - `ref_id`: BIGINT 可为空（注意：device/material 为字符串主键，产线无 ID 表，按契约使用 refType/refId=null 并在文字中说明）
 * - `status`: VARCHAR(16) '未处理' | '已确认' | '已关闭'
 * - `created_at`: TIMESTAMP
 */
@Entity('alert')
export class Alert {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'level', type: 'varchar', length: 8, default: '一般' })
  level!: string;

  @Column({ name: 'type', type: 'varchar', length: 32 })
  type!: string;

  @Column({ name: 'title', type: 'varchar', length: 128 })
  title!: string;

  @Column({ name: 'content', type: 'varchar', length: 512, nullable: true })
  content!: string | null;

  @Column({ name: 'ref_type', type: 'varchar', length: 32, nullable: true })
  refType!: string | null;

  @Column({ name: 'ref_id', type: 'bigint', nullable: true })
  refId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: '未处理' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, insert: false, update: false })
  createdAt!: Date | null;
}
