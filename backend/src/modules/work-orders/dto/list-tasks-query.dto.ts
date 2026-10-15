import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

import { TASK_STATUS_VALUES } from '../work-order-state-machine.js';

/**
 * `GET /api/v1/work-orders/{id}/tasks` 查询参数（契约 §6.3）。
 *
 * `Q 分页、status?:任务枚举`
 */
export class ListTasksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TASK_STATUS_VALUES, {
    message: `status 必须为 ${TASK_STATUS_VALUES.join(' / ')} 之一`,
  })
  status?: string;
}
