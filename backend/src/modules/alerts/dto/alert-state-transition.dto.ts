import { IsIn, IsNotEmpty } from 'class-validator';

/**
 * 预警状态流转 DTO —— 契约 §6.9。
 *
 * 状态定义：
 * - 预警状态：'未处理' | '已确认' | '已关闭'
 * - 预警处理状态（目标状态）：'已确认' | '已关闭'
 * - 候选流转（契约 §6.9）：未处理 → 已确认 → 已关闭
 */
export class AlertStateTransitionDto {
  @IsNotEmpty({ message: 'expectedStatus 不能为空' })
  @IsIn(['未处理', '已确认', '已关闭'], {
    message: 'expectedStatus 必须为 未处理 / 已确认 / 已关闭',
  })
  expectedStatus!: string;

  @IsNotEmpty({ message: 'targetStatus 不能为空' })
  @IsIn(['已确认', '已关闭'], {
    message: 'targetStatus 必须为 已确认 / 已关闭',
  })
  targetStatus!: string;
}
