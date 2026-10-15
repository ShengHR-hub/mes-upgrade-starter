/**
 * 统一错误码表 —— 严格对齐 `docs/api-contract.md` §3。
 *
 * 分段规则：
 * - 0            成功
 * - 1xxxx        请求参数类
 * - 2xxxx        认证 / 授权类
 * - 3xxxx        资源 / 状态类
 * - 4xxxx        限流类
 * - 5xxxx        服务端 / 依赖类
 *
 * 注意：`code` 表达业务结果，HTTP 状态表达协议结果，二者由本文件集中映射，
 * 业务代码不得各自硬编码字符串或状态码。
 */
export enum ErrorCode {
  SUCCESS = 0,

  INVALID_ARGUMENT = 10001,
  INVALID_REFERENCE = 10002,
  INVALID_QUANTITY = 10003,

  UNAUTHENTICATED = 20001,
  TOKEN_EXPIRED = 20002,
  INVALID_CREDENTIALS = 20003,
  FORBIDDEN = 20004,
  PASSWORD_CHANGE_REQUIRED = 20005,

  RESOURCE_NOT_FOUND = 30001,
  RESOURCE_CONFLICT = 30002,
  INVALID_STATE_TRANSITION = 30003,
  REFERENCE_IN_USE = 30004,
  MISSING_PREREQUISITE = 30005,
  CAPABILITY_UNAVAILABLE = 30006,

  RATE_LIMITED = 40001,

  INTERNAL_ERROR = 50001,
  DEPENDENCY_UNAVAILABLE = 50002,
  DEPENDENCY_TIMEOUT = 50003,
}

/** 错误码 → 默认中文提示语。 */
export const ERROR_CODE_MESSAGE: Readonly<Record<number, string>> = Object.freeze({
  [ErrorCode.SUCCESS]: '成功',
  [ErrorCode.INVALID_ARGUMENT]: '参数错误',
  [ErrorCode.INVALID_REFERENCE]: '关联对象不存在',
  [ErrorCode.INVALID_QUANTITY]: '数量不合法',
  [ErrorCode.UNAUTHENTICATED]: '未认证',
  [ErrorCode.TOKEN_EXPIRED]: '登录已过期',
  [ErrorCode.INVALID_CREDENTIALS]: '用户名或密码错误',
  [ErrorCode.FORBIDDEN]: '无权限操作',
  [ErrorCode.PASSWORD_CHANGE_REQUIRED]: '需先修改初始密码',
  [ErrorCode.RESOURCE_NOT_FOUND]: '资源不存在',
  [ErrorCode.RESOURCE_CONFLICT]: '资源冲突',
  [ErrorCode.INVALID_STATE_TRANSITION]: '状态流转不合法',
  [ErrorCode.REFERENCE_IN_USE]: '资源被引用，无法删除',
  [ErrorCode.MISSING_PREREQUISITE]: '缺少必要前置数据',
  [ErrorCode.CAPABILITY_UNAVAILABLE]: '当前能力不可用',
  [ErrorCode.RATE_LIMITED]: '请求过于频繁',
  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误',
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: '依赖服务不可用',
  [ErrorCode.DEPENDENCY_TIMEOUT]: '依赖服务超时',
});

/** 错误码 → HTTP 状态码（契约 §3 表格第 3 列）。 */
export const ERROR_CODE_HTTP_STATUS: Readonly<Record<number, number>> = Object.freeze({
  [ErrorCode.SUCCESS]: 200,
  [ErrorCode.INVALID_ARGUMENT]: 400,
  [ErrorCode.INVALID_REFERENCE]: 400,
  [ErrorCode.INVALID_QUANTITY]: 422,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.PASSWORD_CHANGE_REQUIRED]: 403,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_CONFLICT]: 409,
  [ErrorCode.INVALID_STATE_TRANSITION]: 409,
  [ErrorCode.REFERENCE_IN_USE]: 409,
  [ErrorCode.MISSING_PREREQUISITE]: 422,
  [ErrorCode.CAPABILITY_UNAVAILABLE]: 422,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: 503,
  [ErrorCode.DEPENDENCY_TIMEOUT]: 504,
});

/**
 * HTTP 状态码 → 兜底错误码。
 * 用于把 NestJS 内建异常（NotFoundException / UnauthorizedException 等）
 * 归一到契约错误码，避免出现契约之外的 code。
 */
export const HTTP_STATUS_ERROR_CODE: Readonly<Record<number, ErrorCode>> = Object.freeze({
  400: ErrorCode.INVALID_ARGUMENT,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.RESOURCE_NOT_FOUND,
  409: ErrorCode.RESOURCE_CONFLICT,
  422: ErrorCode.INVALID_QUANTITY,
  429: ErrorCode.RATE_LIMITED,
  500: ErrorCode.INTERNAL_ERROR,
  503: ErrorCode.DEPENDENCY_UNAVAILABLE,
  504: ErrorCode.DEPENDENCY_TIMEOUT,
});
