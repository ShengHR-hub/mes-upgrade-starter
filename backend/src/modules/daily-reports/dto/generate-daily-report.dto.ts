import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class GenerateDailyReportDto {
  @IsString({ message: 'date 必须为字符串' })
  @IsNotEmpty({ message: 'date 不能为空' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 格式必须为 YYYY-MM-DD' })
  date!: string;
}
