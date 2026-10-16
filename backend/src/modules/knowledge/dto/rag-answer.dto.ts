import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, IsOptional } from 'class-validator';

/**
 * F1 企业知识问答请求 DTO —— 契约 §7.3。
 *
 * `POST /api/v1/rag-answers`，B `question:string, topK?:int=3`（1～5）。
 * 三角色（admin / manager / operator）均可用（契约 §5.2 第 19 行）。
 */
export class RagAnswerDto {
  @IsString({ message: 'question 必须为字符串' })
  @Length(1, 2000, { message: 'question 长度必须为 1~2000 个字符' })
  question!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'topK 必须为整数' })
  @Min(1, { message: 'topK 最小为 1' })
  @Max(5, { message: 'topK 最大为 5' })
  topK?: number;
}
