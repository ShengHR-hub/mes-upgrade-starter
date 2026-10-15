import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AuditLog } from '../../entities/audit-log.entity.js';

export interface AuditEntry {
  /** 服务端可信身份的用户 ID（BIGINT 十进制字符串）；无身份时为 null */
  userId: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/**
 * 审计写入服务（`audit_log`）。
 *
 * 硬性约束（任务书 §二.9）：
 * - 审计必须与业务写入**同一事务**提交或回滚 —— 因此接口只接受调用方的
 *   `EntityManager`（事务内），不自行开启事务，也不接受全局 DataSource；
 * - `userId` 取服务端可信身份，**不接受客户端指定**；
 * - 写入内容不得包含密码、完整 JWT、AI Key（契约 §5.1）。
 */
@Injectable()
export class AuditService {
  /** 在给定事务管理器中写入一条审计记录 */
  async write(manager: EntityManager, entry: AuditEntry): Promise<void> {
    await manager.insert(AuditLog, {
      userId: entry.userId,
      action: entry.action,
      target: entry.target ?? null,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null,
    });
  }
}
