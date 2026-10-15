/**
 * 契约 §2.2 / §3：统一返回包体、分页与错误码。
 *
 * 约定要点：
 * - 所有业务响应（含错误）均为 `{ code, message, data }`；
 * - HTTP 状态表达协议结果，`code` 表达业务结果；成功 `code = 0`；
 *   **HTTP 200 但 `code != 0` 仍按业务失败处理**（契约 §2.2）；
 * - 分页固定为 `{ list, total, page, pageSize }`。
 */

/** 契约 §3 错误码表（与 backend/src/common/constants/error-code.ts 对齐） */
export const ERROR_CODES = {
  SUCCESS: 0,
  INVALID_ARGUMENT: 10001,
  INVALID_REFERENCE: 10002,
  INVALID_QUANTITY: 10003,
  UNAUTHENTICATED: 20001,
  TOKEN_EXPIRED: 20002,
  INVALID_CREDENTIALS: 20003,
  FORBIDDEN: 20004,
  PASSWORD_CHANGE_REQUIRED: 20005,
  RESOURCE_NOT_FOUND: 30001,
  RESOURCE_CONFLICT: 30002,
  INVALID_STATE_TRANSITION: 30003,
  REFERENCE_IN_USE: 30004,
  MISSING_PREREQUISITE: 30005,
  CAPABILITY_UNAVAILABLE: 30006,
  RATE_LIMITED: 40001,
  INTERNAL_ERROR: 50001,
  DEPENDENCY_UNAVAILABLE: 50002,
  DEPENDENCY_TIMEOUT: 50003,
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const ERROR_CODE_LABELS: Readonly<Record<number, string>> = {
  [ERROR_CODES.INVALID_ARGUMENT]: '参数错误',
  [ERROR_CODES.INVALID_REFERENCE]: '关联对象不存在',
  [ERROR_CODES.INVALID_QUANTITY]: '数量关系不合法',
  [ERROR_CODES.UNAUTHENTICATED]: '未认证',
  [ERROR_CODES.TOKEN_EXPIRED]: '登录已过期',
  [ERROR_CODES.INVALID_CREDENTIALS]: '账号或密码错误',
  [ERROR_CODES.FORBIDDEN]: '无权限',
  [ERROR_CODES.PASSWORD_CHANGE_REQUIRED]: '需先修改密码',
  [ERROR_CODES.RESOURCE_NOT_FOUND]: '资源不存在',
  [ERROR_CODES.RESOURCE_CONFLICT]: '资源冲突',
  [ERROR_CODES.INVALID_STATE_TRANSITION]: '状态不允许该操作',
  [ERROR_CODES.REFERENCE_IN_USE]: '资源被引用',
  [ERROR_CODES.MISSING_PREREQUISITE]: '缺少必要前置条件',
  [ERROR_CODES.CAPABILITY_UNAVAILABLE]: '能力受限或缺少关键输入',
  [ERROR_CODES.RATE_LIMITED]: '请求过于频繁',
  [ERROR_CODES.INTERNAL_ERROR]: '服务器内部错误',
  [ERROR_CODES.DEPENDENCY_UNAVAILABLE]: '依赖服务不可用',
  [ERROR_CODES.DEPENDENCY_TIMEOUT]: '依赖服务超时',
}

/** 统一返回包体（契约 §2.2） */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/** 分页返回（契约 §2.2） */
export interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 参数校验失败明细（契约 §2.2 示例、S2 交接文档 §7.2） */
export interface FieldError {
  field: string
  reason: string
}

export interface ApiErrorData {
  errors?: FieldError[]
  [key: string]: unknown
}

/** 分页请求公共参数（契约 §2.1：page ≥ 1、pageSize ∈ [1,100]） */
export interface PaginationQuery {
  page?: number
  pageSize?: number
}

/**
 * BIGINT 主键 / 外键。
 *
 * 契约 §2.1：BIGINT ID 使用十进制字符串（如 `"101"`），避免 JavaScript 精度损失。
 * **禁止对 ID 做 Number() 转换**；设备 / 产品 / 物料的 code 是字符串主键，同样保持字符串。
 */
export type Id = string

/**
 * DECIMAL 字段（如 BOM `qty`）。
 *
 * 契约 §2.1：DECIMAL 用字符串表示，例如 `"2.00"`；前端不得自行做浮点运算或改写精度。
 */
export type DecimalString = string

/** 契约 §2.3 数据来源标识 */
export const DATA_SOURCE_KINDS = ['demo', 'enterprise-master', 'enterprise-documents'] as const

export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number]

/** 响应中的来源计算元数据（不写入表列，仅响应存在） */
export interface DataSourceMeta {
  dataSource?: DataSourceKind
  dataLabel?: string
}

export const DATA_SOURCE_LABELS: Readonly<Record<DataSourceKind, string>> = {
  demo: '演示数据',
  'enterprise-master': '企业主数据',
  'enterprise-documents': '企业文档',
}
