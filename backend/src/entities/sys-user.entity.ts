import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 人员账号（`sys_user`）。
 *
 * B9（S10）启用登录 / 改密 / 用户管理：
 * - `passwordHash` 使用 **select: false** —— 常规查询不带出该列，
 *   防止任何实体加载路径把它带进响应或日志（契约 §5.1「不返回 password_hash」）；
 *   需要校验口令时显式 `select: ['id', 'passwordHash']` 查询。
 * - 认证按 Q4 批准口径：HS256、2 小时、iss/aud 固定，**每次请求重新读取
 *   `enabled/role`**，停用或角色变化的旧令牌不能继续沿用旧权限。
 * - 种子数据里的 `password_hash` 是**占位串**，不是可用哈希；账号受控重置
 *   属 AUTH-3 另行授权事项，本模块不重导、不覆盖既有口令。
 */
@Entity('sys_user')
export class SysUser {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'username', type: 'varchar', length: 32 })
  username!: string;

  @Column({ name: 'name', type: 'varchar', length: 32 })
  name!: string;

  @Column({ name: 'dept', type: 'varchar', length: 32, nullable: true })
  dept!: string | null;

  @Column({ name: 'post', type: 'varchar', length: 32, nullable: true })
  post!: string | null;

  @Column({ name: 'role', type: 'varchar', length: 16, default: 'operator' })
  role!: string;

  @Column({ name: 'phone', type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  /** Argon2id 口令哈希；select:false 防止常规查询带出（契约 §5.1） */
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 128,
    select: false,
  })
  passwordHash?: string;

  @Column({ name: 'enabled', type: 'tinyint', default: 1 })
  enabled!: number;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, insert: false, update: false })
  createdAt!: Date | null;
}
