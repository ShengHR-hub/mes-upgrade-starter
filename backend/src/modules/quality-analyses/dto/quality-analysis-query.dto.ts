import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * B11 SPC 质量分析查询 DTO（契约 §6.5）。
 *
 * 约定（契约 §2.1 / §6.5）：
 * - `startDate` / `endDate` 必填，`YYYY-MM-DD`；服务端再校验「真实日历日」与顺序，
 *   并转换为当天 00:00 至结束日次日 00:00 的**严格半开区间**（Asia/Shanghai）；
 * - `prodLine` 可选；为空时不按产线过滤。无任务关联的检验/报工记录**不能**推断产线，
 *   指定产线时不纳入这些记录（契约 §6.5）；
 * - 未知字段由全局 ValidationPipe（whitelist + forbidNonWhitelisted）拒绝。
 */
export class QualityAnalysisBaseQueryDto {
  @IsNotEmpty({ message: 'startDate 不能为空' })
  @IsString({ message: 'startDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须为 YYYY-MM-DD 格式' })
  startDate!: string;

  @IsNotEmpty({ message: 'endDate 不能为空' })
  @IsString({ message: 'endDate 必须为字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须为 YYYY-MM-DD 格式' })
  endDate!: string;

  @IsOptional()
  @IsString({ message: 'prodLine 必须为字符串' })
  @MaxLength(32, { message: 'prodLine 长度不得超过 32' })
  prodLine?: string;
}

/** Pareto 查询（defect.qty 维度，无附加参数） */
export class ParetoQueryDto extends QualityAnalysisBaseQueryDto {}

/** 工序不良率趋势查询（报工数量维度，可按工序过滤） */
export class TrendQueryDto extends QualityAnalysisBaseQueryDto {
  @IsOptional()
  @IsString({ message: 'stepName 必须为字符串' })
  @MaxLength(32, { message: 'stepName 长度不得超过 32' })
  stepName?: string;
}

/** 报工良品率查询（与 Pareto 同参数） */
export class GoodRateQueryDto extends QualityAnalysisBaseQueryDto {}
