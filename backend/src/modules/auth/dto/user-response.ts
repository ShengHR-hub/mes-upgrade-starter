import type { Role } from '../../../common/auth/identity.types.js';

/**
 * 用户响应 DTO —— 契约 §5.3。
 *
 * ⚠️ **绝不包含 password_hash**（契约 §5.1「不返回 password_hash」）。
 */
export interface UserResponse {
  /** BIGINT 十进制字符串（契约 §2.1） */
  id: string;
  username: string;
  name: string;
  dept: string | null;
  post: string | null;
  role: Role;
  phone: string | null;
  enabled: boolean;
}

/** 登录成功响应 data —— 契约 §5.3 `POST /sessions` */
export interface SessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: {
    id: string;
    username: string;
    name: string;
    role: Role;
  };
}

/** `GET /users/me` 响应 data —— 契约 §5.3 */
export interface CurrentUserResponse {
  id: string;
  username: string;
  name: string;
  dept: string | null;
  post: string | null;
  role: Role;
  phone: string | null;
  enabled: boolean;
}
