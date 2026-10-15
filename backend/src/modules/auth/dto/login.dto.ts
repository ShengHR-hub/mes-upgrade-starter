import { IsString, Length } from 'class-validator';

/**
 * `POST /api/v1/sessions` 请求体（契约 §5.3）。
 *
 * `B username:string,password:string`
 *
 * 失败统一 `20003`（不泄露账号存在性）；账号须 enabled（契约 §5.1）。
 */
export class LoginDto {
  @IsString({ message: 'username 必须为字符串' })
  @Length(1, 32, { message: 'username 长度必须为 1~32 个字符' })
  username!: string;

  @IsString({ message: 'password 必须为字符串' })
  @Length(1, 128, { message: 'password 长度必须为 1~128 个字符' })
  password!: string;
}

/**
 * `POST /api/v1/users/me/password-changes` 请求体（契约 §5.3）。
 *
 * `B oldPassword:string,newPassword:string`
 *
 * ⚠️ 密码强度业务策略（Q4-3：长度 ≥8 且含字母与数字）**尚未获用户批准**，
 * 本版只做结构性约束：非空、≤64 字符、不得与旧密码相同。
 * 批准后在该 DTO 增补策略校验，不改接口形状。
 */
export class ChangePasswordDto {
  @IsString({ message: 'oldPassword 必须为字符串' })
  @Length(1, 128, { message: 'oldPassword 长度必须为 1~128 个字符' })
  oldPassword!: string;

  @IsString({ message: 'newPassword 必须为字符串' })
  @Length(1, 64, { message: 'newPassword 长度必须为 1~64 个字符' })
  newPassword!: string;
}
