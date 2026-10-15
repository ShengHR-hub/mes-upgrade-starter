import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * 口令哈希服务 —— AUTH-3 已批准口径：**Argon2id**。
 *
 * 边界与「现有哈希格式兼容」（任务书 §七.7）：
 * - 种子数据里的 `password_hash` 是**占位串**（不是任何可用哈希格式）。对占位串
 *   的校验一律按「口令不匹配」处理（20003），**绝不**静默重写既有哈希、绝不重导账号；
 * - 账号受控重置属 AUTH-3「另行授权」事项，本服务不提供该入口；
 * - 哈希值只进 `sys_user.password_hash` 列，**不进日志、异常、响应、交接文档**
 *   （日志脱敏另由 `redactForLog` 兜底）。
 */
@Injectable()
export class PasswordService {
  /**
   * Argon2id 参数。
   *
   * `@node-rs/argon2` 的默认算法即 **Argon2id**（m=19456, t=2, p=1），
   * 显式 options 省略：其 `Algorithm` 是 ambient const enum，在 isolatedModules
   * 下不可引用；默认值已满足 AUTH-3 批准口径。
   */
  private static readonly OPTIONS = {} as const;

  /** 是否为可校验的 Argon2id 哈希（占位串/空串/旧格式均不可校验） */
  isArgon2Hash(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith('$argon2id$');
  }

  /** 生成 Argon2id 哈希 */
  async hashPassword(plain: string): Promise<string> {
    return hash(plain, PasswordService.OPTIONS);
  }

  /**
   * 校验口令。任何异常（哈希格式不符、内容不符）都归约为 `false`，
   * 由调用方统一返回 20003，不区分「账号不存在」与「口令错误」。
   */
  async verifyPassword(hashValue: string | null | undefined, plain: string): Promise<boolean> {
    if (!this.isArgon2Hash(hashValue)) return false;
    try {
      return await verify(hashValue as string, plain);
    } catch {
      return false;
    }
  }
}
