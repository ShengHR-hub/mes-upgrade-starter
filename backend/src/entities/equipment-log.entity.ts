import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 设备状态变更日志（`equipment_log`）。
 *
 * B7（S10）启用：**仅由设备状态变更接口写**（该接口因 Q3 未决保持关闭），
 * 本版只提供读。不能伪造过去时间；操作人由服务端确定。
 *
 * OEE 计算**不能**只靠本表（契约 §6.7）：缺计划生产时间、设备产出归属、理想节拍时
 * 返回 `oee:null` + `insufficient_data` + missingInputs。
 */
@Entity('equipment_log')
export class EquipmentLog {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'device_code', type: 'varchar', length: 32 })
  deviceCode!: string;

  @Column({ name: 'old_status', type: 'varchar', length: 16, nullable: true })
  oldStatus!: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 16 })
  newStatus!: string;

  @Column({ name: 'changed_by', type: 'bigint', nullable: true })
  changedBy!: string | null;

  @Column({ name: 'remark', type: 'varchar', length: 256, nullable: true })
  remark!: string | null;

  @Column({ name: 'changed_at', type: 'timestamp', nullable: true, insert: false, update: false })
  changedAt!: Date | null;
}
