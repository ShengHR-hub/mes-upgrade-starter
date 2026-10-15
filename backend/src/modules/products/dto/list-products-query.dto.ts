import { IsOptional, IsString, Length } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

/**
 * `GET /api/v1/products` 查询参数（契约 §6.6）。
 *
 * `Q 分页、keyword?:string,line?:string`
 *
 * ⚠️ 依赖范围声明：本接口是 **S5 为订单选择产品而补的「最小只读」接口**，
 * 严格沿用契约 §6.6 已冻结的形状，**不扩展为 B5**（不含 BOM / 工艺路线 / 物料 /
 * 批次 / SN 等其余 B5/B6 接口，也不含任何写入）。
 */
export class ListProductsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'keyword 必须为字符串' })
  @Length(1, 64, { message: 'keyword 长度必须为 1~64 个字符' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: 'line 必须为字符串' })
  @Length(1, 32, { message: 'line 长度必须为 1~32 个字符' })
  line?: string;
}
