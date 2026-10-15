import { ErrorCode } from '../constants/error-code.js';
import type { FieldError } from '../dto/api-response.js';
import { BusinessException } from '../exceptions/business.exception.js';

/** 契约 §2.1：`page?:int=1`、`pageSize?:int=20`，page ≥ 1，pageSize ∈ [1,100]。 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;

/**
 * 只接受十进制非负整数字面量。
 * 明确拒绝：`abc`、`-1`、`+1`、`1.5`、`1e3`、`0x10`、` 1 `、`１`（全角）。
 */
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

/** 请求中的原始分页参数（query string 一律是字符串）。 */
export interface PaginationQuery {
  page?: number | string;
  pageSize?: number | string;
}

/** 归一化后的分页参数，可直接喂给 TypeORM 的 `skip` / `take`。 */
export interface NormalizedPagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

function invalid(field: string, reason: string): BusinessException {
  return new BusinessException(ErrorCode.INVALID_ARGUMENT, '参数错误', {
    errors: [{ field, reason } satisfies FieldError],
  });
}

/**
 * 严格解析单个分页参数。
 *
 * 三重校验，任一不过即抛 10001：
 * 1. 只接受 `string` / `number` —— 数组（`?pageSize[]=10`）、对象一律拒绝；
 * 2. 必须匹配 `/^\d+$/` —— 拒绝非整数字面量与负数；
 * 3. `Number.isSafeInteger` —— 拒绝超出安全整数范围的巨值（如 `9007199254740993`），
 *    避免 `Number()` 静默丢精度后变成一个"看起来合法"的分页值。
 */
function parseUnsignedInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw invalid(field, '必须为单个数字字符串');
  }

  const text = String(value);
  if (!UNSIGNED_INTEGER_PATTERN.test(text)) {
    throw invalid(field, '必须为非负整数');
  }

  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw invalid(field, '数值超出安全整数范围');
  }
  return parsed;
}

/**
 * 归一化分页参数。
 * 缺省取 page=1 / pageSize=20；任何不合法输入按契约 §3 抛 10001（不静默截断、不静默转换）。
 */
export function normalizePagination(query: PaginationQuery = {}): NormalizedPagination {
  const page = parseUnsignedInteger(query.page, 'page') ?? DEFAULT_PAGE;
  const pageSize = parseUnsignedInteger(query.pageSize, 'pageSize') ?? DEFAULT_PAGE_SIZE;

  if (page < 1) {
    throw invalid('page', 'page 必须 ≥ 1');
  }
  if (pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
    throw invalid('pageSize', `pageSize 必须在 ${MIN_PAGE_SIZE}~${MAX_PAGE_SIZE} 之间`);
  }

  // 单独合法的 page / pageSize 相乘后仍可能越界：
  // 例如 page=MAX_SAFE_INTEGER(9007199254740991) + pageSize=100 → skip=900719925474099000。
  // 若不校验计算结果，skip 会静默丢精度，把查询指到一个"看起来合法"的错误偏移量上。
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip)) {
    throw invalid('page', 'page 与 pageSize 组合计算出的偏移量超出安全整数范围');
  }

  return { page, pageSize, skip, take: pageSize };
}
