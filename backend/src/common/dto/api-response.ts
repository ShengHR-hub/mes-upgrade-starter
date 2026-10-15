import { ErrorCode, ERROR_CODE_MESSAGE } from '../constants/error-code.js';

/**
 * 统一返回包体 —— 契约 §2.2。
 * 所有业务响应（含错误）均为 `{code, message, data}`；成功 `code = 0`。
 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 统一分页格式 —— 契约 §2.2。
 * `Page(示例)` 展开为 `{list:[示例], total, page, pageSize}`。
 */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 参数错误的明细项 —— 契约 §2.2 的 `data.errors`。 */
export interface FieldError {
  field: string;
  reason: string;
}

/** 判断值是否已经是统一包体（避免拦截器二次包装）。 */
export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ApiResponse<unknown>>;
  return (
    typeof candidate.code === 'number' &&
    typeof candidate.message === 'string' &&
    'data' in candidate
  );
}

/** 构造成功响应包体。 */
export function ok<T>(data: T, message: string = ERROR_CODE_MESSAGE[ErrorCode.SUCCESS]!): ApiResponse<T> {
  return { code: ErrorCode.SUCCESS, message, data };
}

/** 构造分页结果体（供 `data` 使用，外层再由拦截器包装）。 */
export function page<T>(list: T[], total: number, pageNo: number, pageSize: number): PageResult<T> {
  return { list, total, page: pageNo, pageSize };
}

/** 构造空分页结果体。 */
export function emptyPage<T>(pageNo = 1, pageSize = 20): PageResult<T> {
  return { list: [], total: 0, page: pageNo, pageSize };
}
