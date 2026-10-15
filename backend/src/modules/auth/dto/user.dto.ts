import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

import { IsOptionalNonNull } from '../../../common/dto/is-optional-non-null.js';
import { isRole, type Role } from '../../../common/auth/identity.types.js';

const TEXT_PATTERN = /^[\x20-\x7e\u4e00-\u9fa5]*$/;

/** 三角色枚举校验消息 */
export const ROLE_MESSAGE = 'role 必须为 admin / manager / operator 之一';

function toBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}

/**
 * `GET /api/v1/users` 查询参数（契约 §5.3）。
 *
 * `Q 公共分页、role?:enum,enabled?:boolean,keyword?:string`
 *
 * query 字符串里的布尔值（`?enabled=true`）经 `@Transform` 归一化；
 * 无法识别的值保持原样，由 `@IsBoolean` 拒绝 → 10001。
 */
export class ListUsersQueryDto {
  @IsOptional()
  @IsIn(['admin', 'manager', 'operator'], { message: ROLE_MESSAGE })
  role?: Role;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean({ message: 'enabled 必须为布尔值（true/false）' })
  enabled?: boolean;

  @IsOptional()
  @IsString({ message: 'keyword 必须为字符串' })
  @Length(1, 64, { message: 'keyword 长度必须为 1~64 个字符' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: 'page 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'page 必须为非负整数' })
  page?: string;

  @IsOptional()
  @IsString({ message: 'pageSize 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'pageSize 必须为非负整数' })
  pageSize?: string;
}

/**
 * `POST /api/v1/users` 请求体（契约 §5.3）。
 *
 * `B username:string,name:string,password:string,role:enum,dept?:string,post?:string,phone?:string`
 *
 * - `username` 唯一，重复返回 30002；
 * - `password` 以 **Argon2id** 哈希存储（AUTH-3 已批准口径），响应绝不返回 password_hash；
 * - 不提供「为他人重置密码」入口（AUTH-3：账号重置另行授权，本版不实现）。
 */
export class CreateUserDto {
  @IsString({ message: 'username 必须为字符串' })
  @Length(1, 32, { message: 'username 长度必须为 1~32 个字符' })
  @Matches(/^[A-Za-z0-9._-]{1,32}$/, {
    message: 'username 只能包含字母、数字、点、下划线、连字符',
  })
  username!: string;

  @IsString({ message: 'name 必须为字符串' })
  @Length(1, 32, { message: 'name 长度必须为 1~32 个字符' })
  @Matches(TEXT_PATTERN, { message: 'name 含有不支持的字符' })
  name!: string;

  @IsString({ message: 'password 必须为字符串' })
  @Length(1, 64, { message: 'password 长度必须为 1~64 个字符' })
  password!: string;

  @IsIn(['admin', 'manager', 'operator'], { message: ROLE_MESSAGE })
  role!: Role;

  @IsOptional()
  @IsString({ message: 'dept 必须为字符串' })
  @Length(1, 32, { message: 'dept 长度必须为 1~32 个字符' })
  @Matches(TEXT_PATTERN, { message: 'dept 含有不支持的字符' })
  dept?: string;

  @IsOptional()
  @IsString({ message: 'post 必须为字符串' })
  @Length(1, 32, { message: 'post 长度必须为 1~32 个字符' })
  @Matches(TEXT_PATTERN, { message: 'post 含有不支持的字符' })
  post?: string;

  @IsOptional()
  @IsString({ message: 'phone 必须为字符串' })
  @Matches(/^[0-9-]{1,16}$/, { message: 'phone 只能包含数字与连字符，最长 16 位' })
  phone?: string;
}

/**
 * `PATCH /api/v1/users/{id}` 请求体（契约 §5.3）。
 *
 * `B name?:string,dept?:string/null,post?:string/null,phone?:string/null,role?:enum,enabled?:boolean`
 *
 * - 至少一个字段；`username` 与密码不可经本接口修改；
 * - 普通用户不能借自身资料接口修改 role/enabled：本接口本身即 admin 专属，
 *   且契约未开放 `PATCH /users/me`（自身资料只能改密码，§5.3）；
 * - **最后一个启用 admin 不得停用或降级**（并发安全，服务端强制，30002）。
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'name 必须为字符串' })
  @Length(1, 32, { message: 'name 长度必须为 1~32 个字符' })
  @Matches(TEXT_PATTERN, { message: 'name 含有不支持的字符' })
  name?: string;

  /** null 表示清空；undefined 表示不修改（契约明示 `/null`，用 @IsOptional） */
  @IsOptional()
  @IsString({ message: 'dept 必须为字符串或 null' })
  @Length(1, 32, { message: 'dept 长度必须为 1~32 个字符' })
  @Matches(TEXT_PATTERN, { message: 'dept 含有不支持的字符' })
  dept?: string | null;

  @IsOptional()
  @IsString({ message: 'post 必须为字符串或 null' })
  @Length(1, 32, { message: 'post 长度必须为 1~32 个字符' })
  @Matches(TEXT_PATTERN, { message: 'post 含有不支持的字符' })
  post?: string | null;

  @IsOptional()
  @IsString({ message: 'phone 必须为字符串或 null' })
  @Matches(/^[0-9-]{1,16}$/, { message: 'phone 只能包含数字与连字符，最长 16 位' })
  phone?: string | null;

  @IsOptional()
  @IsIn(['admin', 'manager', 'operator'], { message: ROLE_MESSAGE })
  role?: Role;

  /** 契约未开放 null：用 IsOptionalNonNull，null 进入校验被拒 */
  @IsOptionalNonNull()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean({ message: 'enabled 必须为布尔值（true/false）' })
  enabled?: boolean;
}

/** 服务端布尔过滤器归一化：无法识别 → 10001（不静默转换） */
export function toBooleanFilter(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw Object.assign(new Error(`${field} 必须为布尔值（true/false）`), { field });
}

/** 角色枚举断言（服务端统一入口） */
export function assertRoleValue(value: unknown, field: string): asserts value is Role {
  if (typeof value !== 'string' || !isRole(value)) {
    throw Object.assign(new Error(ROLE_MESSAGE), { field });
  }
}
