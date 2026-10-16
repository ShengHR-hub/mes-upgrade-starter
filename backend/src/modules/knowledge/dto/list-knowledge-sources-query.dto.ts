import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * F1 知识来源清单查询 DTO —— 契约 §7.3。
 *
 * `GET /api/v1/knowledge-sources`，Q 公共分页（契约 §2.1：page ≥ 1，pageSize ∈ [1,100]）。
 */
export class ListKnowledgeSourcesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须为整数' })
  @Min(1, { message: 'page 必须大于等于 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须为整数' })
  @Min(1, { message: 'pageSize 必须大于等于 1' })
  @Max(100, { message: 'pageSize 最大为 100' })
  pageSize?: number;
}
