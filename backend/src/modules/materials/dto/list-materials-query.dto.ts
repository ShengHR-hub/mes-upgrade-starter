import { IsOptional, IsString, Length } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

/**
 * `GET /api/v1/materials` 查询参数（契约 §6.6）。
 *
 * `Q 分页、keyword?:string,category?:string`
 */
export class ListMaterialsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'keyword 必须为字符串' })
  @Length(1, 64, { message: 'keyword 长度必须为 1~64 个字符' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: 'category 必须为字符串' })
  @Length(1, 32, { message: 'category 长度必须为 1~32 个字符' })
  category?: string;
}
