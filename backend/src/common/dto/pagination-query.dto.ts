import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * 分页查询参数 DTO —— 契约 §2.1（`page?:int=1`、`pageSize?:int=20`）。
 *
 * 本 DTO 负责第一道「类型 + 字面量格式」校验：
 * - `@IsString()`：拒绝数组形态（如 `?pageSize[]=10` 会被 Express 解析成 `['10']`）；
 * - `@Matches(/^\d+$/)`：只接受十进制非负整数字面量，拒绝 `abc` / `-1` / `1.5` / `1e3`。
 *
 * 数值范围（page ≥ 1、pageSize ∈ [1,100]）与安全整数检查由
 * `normalizePagination()` 统一完成 —— 控制器必须经该函数取值，不要直接读 DTO 字段。
 */
export class PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'page 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'page 必须为非负整数' })
  page?: string;

  @IsOptional()
  @IsString({ message: 'pageSize 必须为单个数字字符串' })
  @Matches(/^\d+$/, { message: 'pageSize 必须为非负整数' })
  pageSize?: string;
}
