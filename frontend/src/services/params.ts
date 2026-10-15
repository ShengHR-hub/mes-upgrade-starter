/**
 * 查询参数整理（纯函数）。
 *
 * 目的：把界面上的空筛选项（`undefined` / `null` / `''`）剔除，避免把
 * `?status=`、`?keyword=` 这类空值发给后端（后端会按契约拒绝或误判）。
 */

export function compactParams(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    output[key] = value
  }
  return output
}
