#!/usr/bin/env python3
"""MES-AI · FastAPI AI 服务（S3）。

职责边界（docs/api-contract.md §4）：
- 只做 AI：RAG 检索与引用、自然语言意图解析、问数文本组织、预警可能原因、日报文本与建议。
- 不直写业务库、不读业务表（仅读同目录 knowledge.json）；不绕过用户权限（权限由 NestJS 校验）。
- 未配置 AI_BASE_URL/AI_API_KEY/AI_MODEL 时保持本地模式可用（mode="local"）。
- 密钥只从环境变量读取，绝不进入日志或响应体。

内部接口（全部 POST，/api/v1 前缀，统一包体 {code,message,data}）：
  POST /api/v1/ai/rag-answers
  POST /api/v1/ai/query-intents
  POST /api/v1/ai/query-answers
  POST /api/v1/ai/root-cause-analyses
  POST /api/v1/ai/daily-reports
运维接口：
  GET  /api/v1/health   （同时暴露 GET /health，与 S2 NestJS 一致）

S3 审查修复（2026-10-10，v0.2.0）：
  P1-1 删除日报 demo 分支（metrics 必填；离线演示只在 ai-demo/）
  P1-2 日报数字原样透传 NestJS 权威快照（保留 null/calculationStatus；不一致即报错，不补数）
  P1-3 RAG 设备/产品编号 token 级精确匹配；无对应证据 → not_found；设备状态注明「资料记载」
  P1-4 意图解析精确解析显式日期/多日范围；无法确定 → clarification_required；合法组合矩阵
  P1-5 根因只用可定位证据（{type,resourceId,ref,fact}）；证据不足 → insufficient_evidence
  P2-6 严格嵌套 Pydantic 模型（forbid extra）＋必填上下文＋真实日期校验，非法输入一律 10001
  P2-7 模型调用移出事件循环（asyncio.to_thread）＋可配置超时（默认 2 秒）＋空回答回退本地
  P2-8 问数文本维度/数量/比率分开输出；「直通率」说明仅支持报工良品率；标注不等同真实 FPY
  P2-9 透传供应商真实 usage（tokensIn/tokensOut）

S3 补测修复（2026-10-10，v0.3.0）：
  P1 超纲问题不得标 answered（检索分低于阈值 → not_found）
  P2 编号 token 大小写通配（JC-IoT-999 不再误命中 JC-IoT-4G-A）
  P3 不支持的 groupBy/operation 一律 supported:false，不改写成相近组合
  P4 产线/日期限定不得丢失（修 \b 失效；显式日期与相对日取并集区间）
  P5 全 null 查询结果 → no_data
  P6 正常/中性证据不生成原因假设（analysisStatus: no_anomaly / insufficient_evidence）
  P7 日报演示标识（dataSource/dataLabel）必填；snapshotAt 必须为 RFC 3339
  P8 AI_SERVICE_TOKEN 只从**进程环境变量**读取，禁止由 .env 注入（密钥不落盘）

S3 复审修复（2026-10-10，v0.4.0）：
  P1-1 **全部配置只认进程环境变量**（移除 python-dotenv 与 .env 读取），密码/密钥/Token 一律不落盘
  P1-2 RAG 依据校验：编号命中与检索高分之后，仍校验「所问事实是否存在」→ 无依据一律 not_found
  P1-3 意图不改写：区分「明确分组要求（按X/各X/分X）」与「限定语」；补中位数、操作员等不支持项
  P1-4 查询范围不丢：未知产线、多产线、未来日期一律拒绝/澄清，不静默丢弃或改写
  P1-5 问数按**指标类型**判断有效值：字符串型设备状态同样可转述（不再误判 no_data）
  P1-6 证据极性：识别否定式（未发生故障）与零异常事实（不良数量为0）→ 正常证据不生成原因
  P2-7 落实契约必填项（evidence/alerts/snapshotAt）；RFC 3339 必须带时区偏移或 Z
  P2-8 演示标识不仅必填、还要内容一致（dataSource:"demo" ⇔ dataLabel:"演示数据"）

S3 复审二轮修复（2026-10-10，v0.5.0）：
  P1 移除文档/记忆中的明文口令残留；企业原件人员账号表一并脱敏
  P2 移除**不等价指标映射**（交付率/产能/进度…）→ 一律 supported:false 并说明原因
  P3 **复合分组**不再静默丢弃：检查全部明确分组维度，含不支持维度或复合分组一律拒绝

S3 复审三轮修复（2026-10-10，v0.6.0）：
  P1 分组构式补全：捕获**不排除顿号**（按产线、操作员）、新增「每个/每条/每台/每种」构式；
     并取消「已识别到分组就跳过整句扫描」的捷径（按产线查看操作员的产量 也须拦下）
  P1 日报 suggestions 按契约 §4.1 返回**字符串数组**（{alertId,text} 由公开 DTO 层组装）

S3 复审四轮修复（2026-10-10，v0.7.0）：
  P1 **显式分组构式优先于整句关键词猜测**：「SMT-2产线按日期统计产量」不再被"产线"抢占为 groupBy=prodLine；
     产线改为**过滤条件**（prodLine 字段）；「按产线」+ 单条产线限定 → 冲突，要求澄清；
     trend 场景下分组轴固定为 date（产线只作过滤）

S3 复审五轮修复（2026-10-10，v0.8.0）：
  P1 趋势默认日期分组**仅在无明确分组要求时**生效（「按设备查询产量趋势」「按不良类型…趋势」→ supported:false）
  P2 **移除**「按产线 + 单条产线限定」的冲突判定（契约未禁止 groupBy=prodLine 与 prodLine 过滤并存）

启动：uvicorn main:app --port 8000 --host 127.0.0.1
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hmac
import json
import logging
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional, Union

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import (BaseModel, ConfigDict, Field, ValidationError as PydanticValidationError,
                      field_validator, model_validator)
from starlette.exceptions import HTTPException as StarletteHTTPException

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ⚠️ 第四轮 P1-1：**全部配置只认进程环境变量**（不再读取 .env / 不使用 python-dotenv）。
# 这样密码、密钥、Token 一律不落盘；`.env` 即使存在也不会被读取。
_ENV: Dict[str, str] = dict(os.environ)


def _env(key: str, default: str = "") -> str:
    return (_ENV.get(key) or default).strip()

import rag  # noqa: E402  复用 ai-demo 检索算法（派生副本，见文件头说明）

# =========================================================================
# 配置
# =========================================================================
SERVICE_NAME = "mes-ai-service"
VERSION = "0.8.0"
STARTED_AT = time.time()

AI_SERVICE_TOKEN = _env("AI_SERVICE_TOKEN")
LLM_BASE_URL = _env("AI_BASE_URL")
LLM_API_KEY = _env("AI_API_KEY")
LLM_MODEL = _env("AI_MODEL")
LLM_ENABLED = bool(LLM_BASE_URL and LLM_API_KEY)
# 模型调用超时（秒），与 rag.llm_timeout() 同源；默认 2 秒（P2-7 / 决策 7）
LLM_TIMEOUT_SECONDS = rag.llm_timeout()
# 限流占位（决策 7）：首版不启用，仅登记配置位，供后续接 Redis/内存令牌桶
RATE_LIMIT_PER_MINUTE = _env("AI_RATE_LIMIT_PER_MINUTE") or None


def _float_env(key: str, default: float) -> float:
    try:
        v = float(_ENV.get(key, ""))
    except (TypeError, ValueError):
        return default
    return v if v > 0 else default


# RAG「有依据」最低检索分（第三轮 P1）；实测应命中 ≥0.154、超纲 ≤0.083
RAG_MIN_SCORE = _float_env("AI_RAG_MIN_SCORE", 0.12)
# 未覆盖内容片段的最小长度（第四轮 P1-2）：问题中出现「知识库完全没有的连续内容词」即判无依据
RAG_MIN_RESIDUE = int(_float_env("AI_RAG_MIN_RESIDUE", 2))

KB_PATH = os.path.join(BASE_DIR, "knowledge.json")

# =========================================================================
# 统一错误码（对齐 docs/api-contract.md §3，与 S2 error-code.ts 同口径）
# =========================================================================
ERROR_CODE_HTTP: Dict[int, int] = {
    0: 200,
    10001: 400,
    20001: 401,
    20004: 403,
    30001: 404,
    40001: 429,
    50001: 500,
    50002: 503,
    50003: 504,
}
ERROR_CODE_MESSAGE: Dict[int, str] = {
    0: "成功",
    10001: "参数错误",
    20001: "未认证",
    20004: "无权限",
    30001: "资源不存在",
    40001: "请求过于频繁",
    50001: "服务器内部错误",
    50002: "依赖服务不可用",
    50003: "依赖服务超时",
}


class ApiError(Exception):
    """承载契约错误码的业务异常。"""

    def __init__(self, code: int, message: Optional[str] = None,
                 data: Any = None, http_status: Optional[int] = None):
        self.code = code
        self.message = message or ERROR_CODE_MESSAGE.get(code, "错误")
        self.data = data
        self.http_status = http_status or ERROR_CODE_HTTP.get(code, 500)
        super().__init__(self.message)


def envelope(data: Any, message: str = "成功", code: int = 0) -> Dict[str, Any]:
    return {"code": code, "message": message, "data": data}


def error_envelope(code: int, message: Optional[str] = None, data: Any = None) -> Dict[str, Any]:
    return {"code": code, "message": message or ERROR_CODE_MESSAGE.get(code, "错误"), "data": data}


# =========================================================================
# 日志（不含密钥、不含完整请求体）
# =========================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("mes-ai-service")


# =========================================================================
# 知识库 / 检索器（模块级单例，构建一次）
# =========================================================================
def _load_kb() -> List[Dict[str, Any]]:
    with open(KB_PATH, encoding="utf-8") as f:
        return json.load(f)


_KB_DOCS: List[Dict[str, Any]] = _load_kb()
# knowledge.json 无显式 chunkId，按其文档顺序合成稳定标识 kb-001…kb-031（可复现）。
_CHUNK_IDS: List[str] = ["kb-%03d" % (i + 1) for i in range(len(_KB_DOCS))]
_CHUNK_ID_BY_KEY: Dict[tuple, str] = {
    (d.get("source", ""), d.get("text", "")): _CHUNK_IDS[i] for i, d in enumerate(_KB_DOCS)
}

_RETRIEVER: Optional["rag.Retriever"] = None


def get_retriever() -> "rag.Retriever":
    global _RETRIEVER
    if _RETRIEVER is None:
        _RETRIEVER = rag.Retriever(KB_PATH)
    return _RETRIEVER


def _excerpt(text: str, limit: int = 120) -> str:
    flat = re.sub(r"\s+", " ", (text or "").strip())
    return flat if len(flat) <= limit else flat[:limit] + "…"


# 设备/产品/工艺编号：允许大小写混排（如 JC-IoT-4G-A、JC-IoT-NB-A、NB-IoT、TF-SIM）。
# 不能用 [A-Z] 单大写，否则 "JC-IoT-999" 会被截成 "JC-I" 而误命中 JC-IoT-4G-A（第三轮 P2）。
_CODE_TOKEN_RE = re.compile(r"[A-Za-z]{2,}(?:-[A-Za-z0-9]+)+")


def _code_tokens(text: str) -> set:
    """提取编号 token（**完整**匹配：EQP-SMT-00 不得命中 EQP-SMT-001；JC-IoT-999 不得命中 JC-IoT-4G-A）。"""
    return set(_CODE_TOKEN_RE.findall(text or ""))


def _build_prod_line_index() -> set:
    """从知识库推导产线编号集合（形如 `SMT-1线`/`CAL-2线`），用于区分「产线」与「产品/设备编号」。"""
    found = set()
    for d in _KB_DOCS:
        for m in re.findall(r"([A-Za-z]{2,}-\d+)\s*线", d.get("text", "")):
            found.add(m)
    return found


_KNOWN_PROD_LINES: set = _build_prod_line_index()


def _line_with_codes(text: str, codes: set) -> Optional[str]:
    """返回文本中第一个含指定编号 token 的行（token 级相等，非子串）。"""
    for line in (text or "").split("\n"):
        if _code_tokens(line) & codes:
            return line.strip()
    return None


def _cap(s: str, limit: int = 300) -> str:
    s = (s or "").strip()
    return s if len(s) <= limit else s[:limit] + "…"


def _excerpt_for(text: str, question: str, limit: int = 120) -> str:
    """引用摘要：问题中出现设备/产品编号时，优先返回该编号所在行（token 级精确匹配）。"""
    codes = _code_tokens(question)
    if codes:
        line = _line_with_codes(text, codes)
        if line:
            return _excerpt(line, limit)
    return _excerpt(text, limit)


def _chunk_id(source: str, text: str) -> str:
    return _CHUNK_ID_BY_KEY.get((source, text), "kb-000")


# =========================================================================
# RAG 依据校验（第四轮 P1-2）：编号命中 / 检索高分之后，仍须检查「所问事实是否存在」
# =========================================================================
_KB_TEXT: str = "\n".join(d.get("text", "") for d in _KB_DOCS)

# 明确不在企业资料范围内的主题/字段（资料中根本不存在这些事实）
_OUT_OF_SCOPE_KW = (
    "售价", "价格", "单价", "报价", "金额", "成本", "利润", "毛利", "营收", "营业额", "折扣", "优惠", "发票",
    "重量", "尺寸", "颜色", "材质", "寿命", "保修", "售后",
    "工资", "薪资", "待遇", "绩效", "奖金", "社保", "公积金", "年假", "请假", "考勤", "简历", "学历", "年龄", "性别",
    "天气", "气温", "下雨", "股票", "股价", "汇率", "专利", "法律", "诉讼", "疾病", "用药", "挂号", "报销",
)

# 疑问/连接/通用表述：从「未覆盖片段」中剔除，避免把提问措辞误判为超纲内容
_STOP_PHRASES = sorted([
    "现在是什么", "是什么意思", "怎么样", "怎么办", "怎么做", "如何做", "是多少", "是什么", "有哪些", "有多少",
    "是几", "怎么", "如何", "是否", "会不会", "能不能", "能否", "可以", "请给出", "请问", "帮我", "我想知道",
    "想知道", "告诉我", "介绍一下", "介绍", "说明", "解释", "分析", "计算", "比较", "对比", "排序", "筛选",
    "导出", "生成", "汇总", "查看", "查询", "统计", "显示", "列出", "看看", "一下", "以及", "并且", "但是",
    "如果", "那么", "所以", "因为", "关于", "对于", "目前", "当前", "现在", "今天", "昨天", "明天", "后天",
    "前天", "本月", "上月", "本周", "上周", "今年", "去年", "最近",
    # 通用动词/名词（合法提问常见，但知识库未必收录，不应据此判超纲）
    "处理", "包含", "规则", "记录", "情况", "信息", "数据", "相关", "具体", "详细", "主要", "基本", "内容",
    "需要", "要求", "标准", "规范", "方法", "方式", "步骤", "过程", "结果", "作用", "意义", "目的", "目标",
    "计划", "方案", "措施", "建议", "多少种", "几种", "哪些方面", "在哪里", "哪里", "多久", "多长时间",
    "什么时间",
], key=len, reverse=True)

_STOP_CHARS = set(
    "的是在有和与及了呢吗吧啊呀哦什幺怎哪多少如何否会不要请帮我你他她它们"
    "一二三四五六七八九十百千万亿年月日周天时候地得着过很都也就还只才把被让给对从向到于以为上下前后里外间中内"
    "个位名条台种道件次首张份批组类等每个"
)


def _uncovered_content_runs(question: str, reference: Optional[str] = None) -> List[str]:
    """返回问题中「在参照文本里完全没有」的连续中文内容片段（已剔除提问措辞）。

    以参照文本（默认整个知识库）为词典做最大匹配：被 >=2 字库内片段覆盖的字符视为"有依据"；
    连续未被覆盖的片段去掉疑问/通用措辞后若仍 >= RAG_MIN_RESIDUE 字，说明问题
    提到了资料里根本不存在的事实（如「天气」「售价」「报销」）→ 判为无依据。
    """
    ref = _KB_TEXT if reference is None else reference
    n = len(question)
    covered = [False] * n
    for i in range(n):
        for length in range(min(12, n - i), 1, -1):
            seg = question[i:i + length]
            if not all("\u4e00" <= c <= "\u9fff" for c in seg):
                continue
            if seg in ref:
                for k in range(i, i + length):
                    covered[k] = True
                break

    runs: List[str] = []
    cur = ""
    for ch, cov in zip(question, covered):
        if "\u4e00" <= ch <= "\u9fff" and not cov:
            cur += ch
        else:
            if cur:
                runs.append(cur)
                cur = ""
    if cur:
        runs.append(cur)

    out: List[str] = []
    for run in runs:
        s = run
        for p in _STOP_PHRASES:
            s = s.replace(p, "")
        s = "".join(ch for ch in s if ch not in _STOP_CHARS)
        if len(s) >= RAG_MIN_RESIDUE:
            out.append(s)
    return out


def _rag_evidence_problem(question: str) -> Optional[str]:
    """返回「无依据」的原因；None 表示依据校验通过。"""
    hit = next((k for k in _OUT_OF_SCOPE_KW if k in question), None)
    if hit:
        return f"所问内容「{hit}」不在企业资料范围内（资料中无该事实）"
    residues = _uncovered_content_runs(question)
    if residues:
        return f"问题提到的「{'、'.join(residues)}」在知识库中不存在对应记载"
    return None


def _code_answer_covers(question: str, doc: Dict[str, Any], codeset: set) -> bool:
    """编号命中后，仍须检查该编号的记载是否覆盖问题所问内容（第四轮 P1-2）。"""
    q = question
    for c in codeset:
        q = q.replace(c, " ")
    return not _uncovered_content_runs(q, doc.get("text", ""))


# =========================================================================
# 应用
# =========================================================================
app = FastAPI(
    title="MES-AI 服务（内部接口）",
    version=VERSION,
    description=(
        "精创电子 MES 的 AI 服务（FastAPI，端口 8000）。"
        "内部接口仅供 NestJS 通过服务令牌调用，不直接暴露给浏览器；"
        "未配置 LLM 时以本地模式运行。"
    ),
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """注入/回写 X-Request-Id（对齐 S2 的追踪口径），并记录访问日志。"""
    rid = request.headers.get("X-Request-Id", "")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", rid or ""):
        rid = str(uuid.uuid4())
    request.state.request_id = rid
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:  # pragma: no cover - 兜底，避免中间件吞掉响应头
        logger.exception("[%s] 未捕获异常 path=%s", rid, request.url.path)
        response = JSONResponse(status_code=500, content=error_envelope(50001))
    response.headers["X-Request-Id"] = rid
    logger.info(
        "[%s] %s %s -> %s (%.1fms)",
        rid, request.method, request.url.path, response.status_code,
        (time.perf_counter() - t0) * 1000,
    )
    return response


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    rid = getattr(request.state, "request_id", "-")
    return JSONResponse(
        status_code=exc.http_status,
        content=error_envelope(exc.code, exc.message, exc.data),
        headers={"X-Request-Id": rid},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """把框架级 HTTP 异常（404/405 等）也收敛到统一包体。"""
    mapping = {400: 10001, 401: 20001, 403: 20004, 404: 30001,
               405: 10001, 409: 30002, 429: 40001}
    code = mapping.get(exc.status_code, 50001 if exc.status_code >= 500 else 10001)
    rid = getattr(request.state, "request_id", "-")
    return JSONResponse(
        status_code=exc.status_code,
        content=error_envelope(code),
        headers={"X-Request-Id": rid},
    )


_VALIDATION_REASON: Dict[str, str] = {
    "missing": "必填字段缺失",
    "extra_forbidden": "未知字段，请求被拒绝",
    "string_type": "必须为字符串",
    "int_type": "必须为整数",
    "int_parsing": "必须为整数",
    "bool_type": "必须为布尔值",
    "dict_type": "必须为对象",
    "list_type": "必须为数组",
    "string_pattern_mismatch": "格式不合法",
    "json_invalid": "请求体不是合法 JSON",
}


def _validation_reason(err: Dict[str, Any]) -> str:
    t = err.get("type", "")
    ctx = err.get("ctx") or {}
    if t == "string_too_short":
        return f"长度不足，至少需要 {ctx.get('min_length')} 个字符"
    if t == "string_too_long":
        return f"长度超出限制，最多 {ctx.get('max_length')} 个字符"
    if t == "less_than_equal":
        return f"数值超出允许范围，需 ≤ {ctx.get('le')}"
    if t == "greater_than_equal":
        return f"数值超出允许范围，需 ≥ {ctx.get('ge')}"
    return _VALIDATION_REASON.get(t, str(err.get("msg", "参数不合法")).replace("Value error, ", ""))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """把 pydantic 校验错误翻译成契约 10001 + data.errors[{field,reason}]（中文文案）。"""
    errors: List[Dict[str, str]] = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
        field = ".".join(loc) if loc else "(body)"
        errors.append({"field": field, "reason": _validation_reason(err)})
    rid = getattr(request.state, "request_id", "-")
    return JSONResponse(
        status_code=400,
        content=error_envelope(10001, "参数错误", {"errors": errors}),
        headers={"X-Request-Id": rid},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """未预期异常：返回契约 50001 安全文案，不暴露栈/内部细节。"""
    rid = getattr(request.state, "request_id", "-")
    logger.exception("[%s] 内部错误 path=%s", rid, request.url.path)
    return JSONResponse(
        status_code=500,
        content=error_envelope(50001),
        headers={"X-Request-Id": rid},
    )


# =========================================================================
# 认证：服务令牌（不接受普通用户 JWT）
# =========================================================================
async def require_service_token(authorization: Optional[str] = Header(default=None)) -> bool:
    if not AI_SERVICE_TOKEN:
        # 未配置令牌 = 内部接口不可用（fail-closed），不静默放行
        raise ApiError(20001, "服务令牌未配置，内部接口不可用")
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(20001, "缺少服务令牌（Authorization: Bearer <AI_SERVICE_TOKEN>）")
    token = authorization[len("Bearer "):].strip()
    if not hmac.compare_digest(token, AI_SERVICE_TOKEN):
        raise ApiError(20001, "服务令牌无效")
    return True


# =========================================================================
# 请求模型（P2-6：严格嵌套模型，extra=forbid，未知/非法字段一律 10001）
# =========================================================================
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_iso_date(value: str) -> str:
    """校验 YYYY-MM-DD 且必须是真实日历日（拒绝 2026-13-45）。"""
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError("日期格式必须为 YYYY-MM-DD")
    try:
        dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("日期不是有效日历日") from exc
    return value


_RFC3339_TZ_RE = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")


def _check_rfc3339(value: str) -> str:
    """校验 RFC 3339 时间（第三轮 P7 / 第四轮 P2-7）。

    必须含 'T' 分隔符，且**必须带时区偏移或 Z**（拒绝 `2026-10-09`、`2026-10-09T09:00:00`）。
    """
    if not isinstance(value, str) or "T" not in value:
        raise ValueError("时间格式必须为 RFC 3339（如 2026-10-09T09:00:00+08:00）")
    if not _RFC3339_TZ_RE.search(value):
        raise ValueError("RFC 3339 时间必须带时区偏移或 Z（如 +08:00 / Z）")
    try:
        dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("时间不是有效的 RFC 3339 时间") from exc
    return value


class StrictModel(BaseModel):
    """内部接口的嵌套对象一律拒绝未知字段（契约 §2.1）。"""

    model_config = ConfigDict(extra="forbid")


class UserContext(StrictModel):
    """仅信任 NestJS 传入的已认证身份；本服务不做权限判定。"""

    userId: str = Field(min_length=1, max_length=64)
    role: str = Field(min_length=1, max_length=32)


class DateContext(StrictModel):
    today: str
    timeZone: str = Field(min_length=1, max_length=64)

    @field_validator("today")
    @classmethod
    def _today_must_be_date(cls, v: str) -> str:
        return _check_iso_date(v)


class EvidenceItem(StrictModel):
    """决策 6：evidence 四字段必填，禁止猜引用。"""

    type: str = Field(min_length=1, max_length=64)
    resourceId: str = Field(min_length=1, max_length=128)
    ref: str = Field(min_length=1, max_length=256)
    fact: str = Field(min_length=1, max_length=1000)


class CauseItem(StrictModel):
    text: str
    evidenceRefs: List[str] = Field(default_factory=list)


class AlertItem(StrictModel):
    """预警 DTO（§6.1）＋ 根因字段（§7.2）。字段名严格，标量宽松透传。

    第三轮 P7：`type` 为必填（空对象 `{}` → 10001），避免对无类型预警做无依据分析。
    """

    type: str = Field(min_length=1, max_length=64)
    id: Optional[Union[str, int]] = None
    alertId: Optional[Union[str, int]] = None
    level: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    refType: Optional[str] = None
    refId: Optional[Union[str, int]] = None
    status: Optional[str] = None
    createdAt: Optional[str] = None
    dataSource: Optional[str] = None
    dataLabel: Optional[str] = None
    possibleCauses: List[CauseItem] = Field(default_factory=list)
    explanation: Optional[str] = None
    suggestion: Optional[str] = None
    analysisStatus: Optional[str] = None


class RagAnswerRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    topK: int = Field(default=3, ge=1, le=5, strict=True)
    userContext: UserContext
    requestId: str = Field(min_length=1, max_length=128)


class QueryIntentsRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    dateContext: DateContext
    userContext: UserContext
    requestId: str = Field(min_length=1, max_length=128)


class QueryAnswersRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    # queryResult 结构由 QueryResultDTO 严格校验（保留原始值用于透传）
    queryResult: Dict[str, Any]
    userContext: UserContext
    requestId: str = Field(min_length=1, max_length=128)


class RootCauseRequest(StrictModel):
    """契约 §4.1：`alert, evidence, snapshotAt, userContext, requestId` 均为必填（第四轮 P2-7）。"""

    alert: AlertItem
    evidence: List[EvidenceItem]
    snapshotAt: str
    userContext: UserContext
    requestId: str = Field(min_length=1, max_length=128)

    @field_validator("snapshotAt")
    @classmethod
    def _snapshot_must_be_rfc3339(cls, v: str) -> str:
        return _check_rfc3339(v)


class DailyReportRequest(StrictModel):
    """契约 §4.1：`date, metrics, alerts, snapshotAt, userContext, requestId` 均为必填（第四轮 P2-7）。"""

    date: str
    # metrics 结构由 DashboardDTO 严格校验（保留原始值用于原样透传）
    metrics: Dict[str, Any]
    alerts: List[AlertItem]
    snapshotAt: str
    userContext: UserContext
    requestId: str = Field(min_length=1, max_length=128)

    @field_validator("date")
    @classmethod
    def _date_must_be_date(cls, v: str) -> str:
        return _check_iso_date(v)

    @field_validator("snapshotAt")
    @classmethod
    def _snapshot_must_be_rfc3339(cls, v: str) -> str:
        return _check_rfc3339(v)


# ---- 内部契约的嵌套 DTO（用于手动校验，保留原始值用于透传） ----
class ColumnDTO(StrictModel):
    key: str
    label: str
    type: Optional[str] = None
    unit: Optional[str] = None


class QuerySpecDTO(StrictModel):
    metric: str
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    prodLine: Optional[str] = None


class SourceDTO(StrictModel):
    resource: str
    filters: Optional[Dict[str, Any]] = None


class QueryResultDTO(StrictModel):
    """§7.1 QueryAnswer（数字与来源由 NestJS 提供）。"""

    answerStatus: Optional[str] = None
    answer: Optional[str] = None
    query: Optional[QuerySpecDTO] = None
    columns: List[ColumnDTO] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    sources: List[SourceDTO] = Field(default_factory=list)
    mode: Optional[str] = None
    degraded: bool = False
    snapshotAt: Optional[str] = None
    dataSource: Optional[str] = None
    dataLabel: Optional[str] = None


class DashboardMetricsDTO(StrictModel):
    planQty: Optional[Union[int, float]] = None
    planTotalQty: Optional[Union[int, float]] = None
    doneQty: Optional[Union[int, float]] = None
    outputQty: Optional[Union[int, float]] = None
    goodQty: Optional[Union[int, float]] = None
    badQty: Optional[Union[int, float]] = None
    completionRate: Optional[Union[int, float]] = None
    goodRate: Optional[Union[int, float]] = None
    isTrueFpy: Optional[bool] = None
    calculationStatus: Optional[str] = None
    missingInputs: Optional[List[str]] = None


class LineItemDTO(StrictModel):
    prodLine: Optional[str] = None
    planQty: Optional[Union[int, float]] = None
    planTotalQty: Optional[Union[int, float]] = None
    doneQty: Optional[Union[int, float]] = None
    outputQty: Optional[Union[int, float]] = None
    goodQty: Optional[Union[int, float]] = None
    badQty: Optional[Union[int, float]] = None
    completionRate: Optional[Union[int, float]] = None
    goodRate: Optional[Union[int, float]] = None


class DashboardDTO(StrictModel):
    """§6.8 Dashboard。

    第三轮 P7：`dataSource`/`dataLabel` 为**必填**（契约 §2.3 演示标识字段）。
    第四轮 P2-8：不仅必填，还要**内容一致** —— `dataSource:"demo"` 必须配
    `dataLabel:"演示数据"`，且两者不得为空白串。
    """

    startDate: Optional[str] = None
    endDate: Optional[str] = None
    snapshotAt: Optional[str] = None
    metrics: DashboardMetricsDTO
    lines: List[LineItemDTO] = Field(default_factory=list)
    dataSource: str = Field(min_length=1, max_length=64)
    dataLabel: str = Field(min_length=1, max_length=64)

    @field_validator("dataSource", "dataLabel")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("不能为空白字符串")
        return v.strip()

    @model_validator(mode="after")
    def _demo_label_must_match(self) -> "DashboardDTO":
        if self.dataSource == "demo" and self.dataLabel != "演示数据":
            raise ValueError('dataSource 为 "demo" 时，dataLabel 必须为 "演示数据"')
        return self


def _validate_nested(model_cls, data: Any, label: str):
    """手动校验嵌套 DTO；失败统一转 10001（绝不 500）。"""
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as exc:
        errors: List[Dict[str, str]] = []
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", [])]
            field = label + ("." + ".".join(loc) if loc else "")
            errors.append({"field": field, "reason": _validation_reason(err)})
        raise ApiError(10001, "参数错误", {"errors": errors}) from exc


# =========================================================================
# 工具函数
# =========================================================================
def _now_iso() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="milliseconds")


def _elapsed_ms(t0: float) -> int:
    return int(round((time.perf_counter() - t0) * 1000))


def _fmt_num(v: Any) -> str:
    if v is None:
        return "无数据"
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return f"{v:.2f}"
    return str(v)


_ZERO_USAGE: Dict[str, int] = {"tokensIn": 0, "tokensOut": 0}


# =========================================================================
# 1. POST /api/v1/ai/rag-answers
# =========================================================================
def _rag_payload(answer_status: str, answer: str, citations: List[Dict[str, Any]],
                 mode: str, degraded: bool, usage: Dict[str, int], t0: float,
                 reason: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "answerStatus": answer_status,
        "answer": answer,
        "citations": citations,
        "knowledgeSource": "enterprise-documents",
        "mode": mode,
        "degraded": degraded,
        "usage": usage,
        "latencyMs": _elapsed_ms(t0),
    }
    if reason:
        payload["reason"] = reason
    return payload


def _citation_for_doc(doc: Dict[str, Any], codeset: set,
                      scores: Dict[tuple, float]) -> Dict[str, Any]:
    text = doc["text"]
    line = _line_with_codes(text, codeset) or text
    return {
        "sourceName": doc["source"],
        "chunkId": _chunk_id(doc["source"], text),
        "relevance": round(min(1.0, max(0.0, scores.get((doc["source"], text), 0.0))), 3),
        "excerpt": _excerpt(line),
    }


def _code_answer(question: str, doc: Dict[str, Any], codeset: set) -> str:
    """编号类问题：直接引用知识库中该编号所在行（P1-3）。

    涉及设备状态时必须表述为「资料记载」，不得暗示实时状态（契约 §7.3）。
    """
    line = _cap(_line_with_codes(doc["text"], codeset) or doc["text"])
    is_device = any(c.startswith("EQP") for c in codeset) \
        or "设备" in question or "状态" in question
    if is_device:
        return (f"根据企业资料记载（{doc['source']}）：{line}\n"
                "说明：以上为知识库资料记载，不代表设备实时状态。")
    return f"根据企业资料（{doc['source']}）：{line}"


@app.post("/api/v1/ai/rag-answers", dependencies=[Depends(require_service_token)])
async def rag_answers(body: RagAnswerRequest) -> Dict[str, Any]:
    t0 = time.perf_counter()
    question = body.question.strip()
    top_k = body.topK

    # --- 第四轮 P1-2：先校验「所问事实是否存在」；编号命中与检索高分都不得绕过 ---
    evidence_problem = _rag_evidence_problem(question)
    if evidence_problem:
        return envelope(_rag_payload("not_found", "资料中没有相关信息", [],
                                     "local", False, dict(_ZERO_USAGE), t0,
                                     reason=evidence_problem))

    # 产线编号（SMT-2 等）不按「产品/设备编号」精确匹配处理：走正常检索更合适
    codes = [t for t in dict.fromkeys(_CODE_TOKEN_RE.findall(question))
             if t not in _KNOWN_PROD_LINES]

    # --- P1-3：问题含设备/产品编号时，必须完整精确匹配（token 级）---
    if codes:
        codeset = set(codes)
        matched = [d for d in _KB_DOCS if _code_tokens(d["text"]) & codeset]
        if not matched:
            return envelope(_rag_payload(
                "not_found", "资料中没有相关信息", [], "local", False, dict(_ZERO_USAGE), t0,
                reason=f"编号「{'、'.join(codes)}」在知识库中没有对应记载，不就近返回其他编号的内容"))

        scores = {(h["source"], h["text"]): float(h["score"])
                  for h in get_retriever().search(question, top_k=max(len(_KB_DOCS), 1))}
        matched.sort(key=lambda d: -scores.get((d["source"], d["text"]), 0.0))
        # 编号命中后仍须检查所问事实是否存在于该编号的记载中（第四轮 P1-2）
        matched = [d for d in matched if _code_answer_covers(question, d, codeset)]
        if not matched:
            return envelope(_rag_payload(
                "not_found", "资料中没有相关信息", [], "local", False, dict(_ZERO_USAGE), t0,
                reason=f"知识库中关于「{'、'.join(codes)}」的记载不包含所问内容"))
        matched = matched[:top_k]
        citations = [_citation_for_doc(d, codeset, scores) for d in matched]
        answer = _code_answer(question, matched[0], codeset)
        # 编号问题走确定性引用，不调用模型（mode 反映实际执行路径）
        return envelope(_rag_payload("answered", answer, citations, "local",
                                     False, dict(_ZERO_USAGE), t0))

    hits = get_retriever().search(question, top_k=top_k)
    # --- 第三轮 P1：知识库无相关证据（无命中，或最高分低于阈值）一律 not_found，不得标 answered ---
    if not hits or float(hits[0]["score"]) < RAG_MIN_SCORE:
        return envelope(_rag_payload(
            "not_found", "资料中没有相关信息", [], "local", False, dict(_ZERO_USAGE), t0,
            reason="知识库检索相关度过低（无匹配记载）"))

    # --- 无编号问题：模型优先，失败/超时/空文本一律回退本地（P2-7 / P2-9）---
    degraded = False
    usage: Dict[str, int] = dict(_ZERO_USAGE)
    mode = "local"
    if LLM_ENABLED:
        try:
            # 同步模型调用移出事件循环，避免阻塞健康检查；超时由 socket 超时兜底
            result = await asyncio.wait_for(
                asyncio.to_thread(rag.ask, question, top_k),
                timeout=LLM_TIMEOUT_SECONDS + 1.0,
            )
            raw_mode = str(result.get("mode") or "")
            answer_text = (result.get("answer") or "").strip()
            usage = result.get("usage") or usage
            if raw_mode.startswith("llm") and answer_text:
                mode = "llm"
            else:
                degraded = True
        except Exception as exc:  # 超时 / 网络 / 响应格式异常
            logger.warning("模型调用失败或超时，回退本地模式：%s", type(exc).__name__)
            degraded = True

    if mode == "llm":
        answer = answer_text
    else:
        answer = rag.extractive_answer(question, hits) or "资料中没有相关信息"

    citations = [
        {
            "sourceName": h["source"],
            "chunkId": _chunk_id(h["source"], h["text"]),
            "relevance": round(min(1.0, max(0.0, float(h["score"]))), 3),
            "excerpt": _excerpt_for(h["text"], question),
        }
        for h in hits
    ]

    return envelope(_rag_payload("answered", answer, citations, mode, degraded, usage, t0))


# =========================================================================
# 2. POST /api/v1/ai/query-intents  （本地规则，不调 LLM）
# =========================================================================
ALLOWED_METRICS = {"goodRate", "completionRate", "goodQty", "badQty",
                   "outputQty", "defectQty", "deviceStatus"}
ALLOWED_GROUPS = {"prodLine", "date", "defectType", "device"}
ALLOWED_OPS = {"list", "trend", "minimum", "maximum"}

_METRIC_KW: Dict[str, List[str]] = {
    # 只保留**语义等价**的口径（第五轮 P2：不等价的说法不得替换成其他指标）
    "goodRate": ["报工良品率", "良品率", "良率", "直通率", "合格率"],
    "completionRate": ["累计完成率", "完成率"],
    "goodQty": ["良品数量", "良品数", "良品量", "合格数"],
    # S9：补「不良品」（语义等价于不良数量），避免「这天不良品最多」被 defectQty 的
    # 「不良」抢先命中成「不良类型」口径；不影响「不良原因/不良类型」命中 defectQty。
    "badQty": ["不良品数量", "不良品数", "不良品", "不良数量", "不良数"],
    "outputQty": ["总产量", "产量", "产出"],
    "defectQty": ["不良原因", "不良类型", "缺陷类型", "缺陷数", "不良"],
    "deviceStatus": ["设备状态", "设备情况", "设备"],
}
# 常见但**不等价**的说法 → 明确不支持（返回 supported:false，不映射到相近指标）
# 注意：该判定**优先于**指标识别 —— 否则「查询设备效率」会被"设备"命中成 deviceStatus
_NON_EQUIVALENT_METRIC_KW = {
    "交付率": "交付率按订单交付统计，与本服务的累计完成率（末道工序累计良品÷计划总数）不是同一口径",
    "准时交付率": "交付类指标未在本版支持范围内",
    "产能": "产能是设备/产线能力，与「产量」（实际产出）不是同一指标",
    "效率": "效率类指标（含设备效率/生产效率）未在本版支持范围内",
    "稼动率": "稼动率未在本版支持范围内",
    "成本": "成本类指标未在本版支持范围内",
    "进度": "「进度」含义不唯一（订单/工单/工序进度），无法确定对应指标",
}
_SUPPORTED_METRIC_HINT = "本版支持：报工良品率/累计完成率/良品数/不良数/产量/不良类型数/设备状态。"
_GROUP_KW: Dict[str, List[str]] = {
    "prodLine": ["产线", "生产线"],
    # S9：补「哪天/哪日」（契约 §7.1 示例「这周哪天不良品最多？」→ groupBy=date）与
    # 「各天」（与「各」分组构式的日期单位豁免配套，见 _GROUPING_PATTERNS）
    "date": ["每天", "每日", "各天", "哪天", "哪日", "按天", "日期", "趋势", "走势", "7天", "七天"],
    "defectType": ["不良类型", "缺陷类型", "不良原因"],
    "device": ["设备"],
}
_OP_KW: Dict[str, List[str]] = {
    "minimum": ["最低", "最少", "最小", "最差"],
    "maximum": ["最高", "最多", "最大", "最好"],
    "trend": ["趋势", "走势", "变化"],
    "list": ["列表", "有哪些", "分别", "各个"],
}


def _pick_by_longest(text: str, table: Dict[str, List[str]]) -> Optional[str]:
    """在文本中查找关键字，返回命中的最长关键字所属取值（避免'不良'压过'不良原因'）。"""
    best_kw, best_val = "", None
    for value, kws in table.items():
        for kw in kws:
            if kw in text and len(kw) > len(best_kw):
                best_kw, best_val = kw, value
    return best_val


def _extract_prod_lines(text: str) -> List[str]:
    """识别问题中出现的**产线编号**（第三轮 P4 / 第四轮 P1-4）。

    - 只认知识库中真实存在的产线编号（`SMT-1/2/3`、`ASSY-1/2`、`CAL-1/2`）；
    - **不使用 `\\b`**：中文是 `\\w`，中文与 ASCII 之间没有词边界，
      原 `\\b([A-Z]{2,}-\\d+)` 会导致「查看SMT-2产量」丢失产线限定；
    - 返回**全部**命中的产线（多产线由调用方判为不支持，不静默只取第一条）。
    """
    t = text or ""
    found: List[str] = []
    for line in sorted(_KNOWN_PROD_LINES, key=len, reverse=True):
        if re.search(r"(?<![A-Za-z0-9\-])" + re.escape(line) + r"(?!\d)", t):
            found.append(line)
    return found


def _unknown_prod_lines(text: str) -> List[str]:
    """识别「形如产线但知识库中不存在」的编号（如 SMT-999、XXX-9），不得静默丢弃。

    S9 审查 P2-2：原实现只检查已知前缀（SMT/ASSY/CAL），导致「今天XXX-9线的产量」
    这类未知前缀编号绕过检测、过滤条件被清空后扩大为全厂查询。
    现改为：任何「字母段-数字段」形态的编号，只要不在 _KNOWN_PROD_LINES 即视为未知产线。
    不作为产线编号的其他形态（JC-PLC-2001 等产品/设备编号）因前导否定前瞻不会误命中；
    宁可要求澄清，也不移除过滤条件继续查询。
    """
    out: List[str] = []
    for m in re.finditer(r"(?<![A-Za-z0-9\-])([A-Za-z]{2,}-\d+)(?![\dA-Za-z\-])", text or ""):
        cand = m.group(1)
        if cand not in _KNOWN_PROD_LINES:
            out.append(cand)
    return list(dict.fromkeys(out))


# 无法精确解析的时间表述 → 不猜测，返回 clarification_required（P1-4）
_AMBIGUOUS_PERIODS = ("上个月", "上月", "上个季度", "上季度", "上一季度", "本月", "本季度",
                      "今年", "去年", "明年", "上周", "下周", "下半年", "上半年")
# 未来日期：不得静默改写成今天（第四轮 P1-4）→ 要求澄清
_FUTURE_PERIODS = ("明天", "明日", "后天", "下周", "下个月", "下月", "明年", "未来")
_CN_DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")


def _parse_dates(question: str, date_ctx: DateContext):
    """解析日期范围，返回 (start, end, status, reason)。

    status ∈ {"ok", "clarification"}；clarification 时 start/end 为 None。
    规则（第三轮 P4 / 第四轮 P1-4）：**收集全部日期线索后取并集区间**，显式日期与相对日
    混用不得丢弃任何一方；未来日期与无法确定的周期一律澄清，绝不静默改写。
    """
    tz = dt.timezone(dt.timedelta(hours=8))
    today = dt.date.fromisoformat(date_ctx.today) if date_ctx \
        else dt.datetime.now(tz).date()

    # 未来日期 → 澄清（数据只覆盖历史与当日，不得改写成今天）
    if any(k in question for k in _FUTURE_PERIODS):
        return None, None, "clarification", "查询范围只覆盖历史与当日数据，请给出已发生的日期或区间。"

    # 无法精确解析的周期表述 → 要求澄清，不猜测
    if any(k in question for k in _AMBIGUOUS_PERIODS):
        return None, None, "clarification", \
            "无法从问题中确定统计时间范围，请明确日期或时间区间（例如：2026-10-01、昨天、近7天）。"

    days: List[dt.date] = []

    # 1) 显式 ISO 日期（可多个）
    for s in re.findall(r"\d{4}-\d{2}-\d{2}", question):
        try:
            days.append(dt.date.fromisoformat(s))
        except ValueError:
            return None, None, "clarification", "问题中的日期不是有效日历日，请重新给出。"

    # 2) 中文日期 2026年10月1日
    for y, m, d in _CN_DATE_RE.findall(question):
        try:
            days.append(dt.date(int(y), int(m), int(d)))
        except ValueError:
            return None, None, "clarification", "问题中的日期不是有效日历日，请重新给出。"

    # 3) 近 N 天（区间）
    m = re.search(r"(?:近|最近|过去)\s*(\d{1,3})\s*天", question)
    if m:
        n = max(1, int(m.group(1)))
        days.extend([today - dt.timedelta(days=n - 1), today])
    elif any(k in question for k in ("近7天", "最近7天", "近七天", "最近七天", "7天", "七天")):
        days.extend([today - dt.timedelta(days=6), today])

    # 4) 本周（周一至今天）
    if any(k in question for k in ("本周", "这周", "本星期")):
        days.extend([today - dt.timedelta(days=today.weekday()), today])

    # 5) 相对日（"昨天和今天"、"2026-10-01 到今天" 等混用一并并入）
    if "前天" in question:
        days.append(today - dt.timedelta(days=2))
    if "昨天" in question or "昨日" in question:
        days.append(today - dt.timedelta(days=1))
    if "今天" in question or "今日" in question:
        days.append(today)

    if days:
        return min(days).isoformat(), max(days).isoformat(), "ok", ""
    return today.isoformat(), today.isoformat(), "ok", ""


# 明确超出白名单的分组/操作 → 一律 supported:false，绝不改写成「相近」的支持组合
# （第三轮 P3 / 第四轮 P1-3：补齐「操作员」「中位数」等漏项）
_UNSUPPORTED_GROUP_KW = (
    "车间", "工段", "班组", "部门", "工序", "工位", "班次", "客户", "供应商", "产品线",
    "操作员", "操作者", "人员", "员工", "工人", "机台", "机型", "订单", "工单", "物料", "产品",
)
_UNSUPPORTED_OP_KW = (
    "平均", "均值", "中位", "众数", "标准差", "方差", "汇总", "合计", "总计", "占比",
    "比例", "环比", "同比", "排名", "排序", "增幅", "降幅",
)
# 明确的分组构式（区分「限定语」与「分组要求」）：按X / 各X / 每个X / X分组
# 注意：捕获类**不排除顿号**，否则「按产线、操作员」会在顿号处被截断而丢掉操作员（第六轮 P1）
_GROUPING_PATTERNS = (
    re.compile(r"按\s*([^，。；？?\s]{1,24})"),
    # S9：「各」后接日期单位（各天/每日/各周…）是**日期口径**，不是分组维度，
    # 与「每」构式保持同样的否定前瞻，避免「各天良品数」被捕获成未知维度而误拒。
    re.compile(r"各(?![天日周月年季])\s*([^，。；？?\s]{1,24})"),
    # 「每个/每条/每台/每种/每位/每名/每批」；排除 每天/每日/每月/每年/每周/每季（属日期口径）
    re.compile(r"每(?:个|条|台|种|位|名|批)?(?!天|日|月|年|周|季)\s*([^，。；？?\s]{1,24})"),
    re.compile(r"([^，。；？?\s]{1,12})\s*分组"),
)
# 分组短语的终止词（遇到即截断）
_GROUP_TERMINATORS = ("查询", "统计", "查看", "列表", "显示", "给出", "结果", "数据", "情况",
                      "对比", "排序", "筛选", "导出")
# 维度之间的连词/分隔符（含顿号）
_GROUP_SPLIT_RE = re.compile(r"[和与及、,，/]|以及")


def _first_unsupported(text: str, kws) -> Optional[str]:
    for kw in kws:
        if kw in text:
            return kw
    return None


def _group_keys_in(part: str) -> set:
    """返回片段中出现的**受支持**分组维度集合（可能多于一个 → 复合分组）。"""
    found = set()
    for gkey, kws in _GROUP_KW.items():
        for kw in kws:
            if kw in part:
                found.add(gkey)
    return found


# 「车间里 / 车间内 / 车间中」这类是**范围限定语**，不是分组要求
_LOCATIVE_SUFFIX = ("里", "内", "中")


def _unsupported_group_hit(text: str) -> Optional[str]:
    """在文本中查找不支持的分组维度词（带方位后缀的限定语豁免）。

    第六轮 P1：只要句中**任何位置**出现不支持维度（如「按产线查看操作员的产量」中的操作员），
    都不能因为"已经识别到产线"就跳过检查。
    """
    for kw in _UNSUPPORTED_GROUP_KW:
        for m in re.finditer(re.escape(kw), text):
            nxt = text[m.end():m.end() + 1]
            if nxt in _LOCATIVE_SUFFIX:
                continue
            return kw
    return None


def _explicit_grouping_dimensions(text: str) -> List[str]:
    """返回**全部**「明确分组要求」的维度短语（第五轮 P3）。

    只检查首个命中维度会把「按产线和操作员」里的操作员静默丢掉，
    因此这里收集所有构式命中的维度，并按连词（和/与/及/、）拆成多个维度。
    """
    dims: List[str] = []
    for pat in _GROUPING_PATTERNS:
        for m in pat.finditer(text):
            seg = m.group(1)
            cut = len(seg)
            for t in _GROUP_TERMINATORS:
                idx = seg.find(t)
                if 0 < idx < cut:
                    cut = idx
            seg = seg[:cut]
            for part in _GROUP_SPLIT_RE.split(seg):
                part = part.strip("的了和与及 ")
                if part:
                    dims.append(part)
    return list(dict.fromkeys(dims))


def _is_allowed_combo(metric: str, group_by: str, operation: str) -> bool:
    """合法组合矩阵（决策 1，非笛卡尔积；**与 NestJS 执行器实际能力严格一致**）。

    S9 审查 P2-4 修复：原矩阵放行了执行器未实现的分组（如 outputQty/device/list），
    导致列声明 device 而行结构实为日期/产线。收紧规则（与后端
    `isAllowedQueryCombo` 同口径）：
    - deviceStatus 仅支持 groupBy=device + operation=list（当前快照）；
    - defectQty 支持 groupBy ∈ {defectType, prodLine, date}；
    - 其余指标仅支持 groupBy ∈ {prodLine, date}（无设备级产量归属）；
    - trend 仅用于 groupBy=date；
    - minimum/maximum 需要可比维度（prodLine/date）。
    """
    if metric not in ALLOWED_METRICS or group_by not in ALLOWED_GROUPS or operation not in ALLOWED_OPS:
        return False
    if metric == "deviceStatus":
        return group_by == "device" and operation == "list"
    if metric == "defectQty":
        allowed_groups = {"defectType", "prodLine", "date"}
    else:
        allowed_groups = {"prodLine", "date"}
    if group_by not in allowed_groups:
        return False
    if operation == "trend":
        return group_by == "date"
    if operation in ("minimum", "maximum"):
        return group_by in ("prodLine", "date")
    return True


def _intent_unsupported(reason: str, t0: float, clarification: bool = False) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "supported": False,
        "reason": reason,
        "usage": dict(_ZERO_USAGE),
        "latencyMs": _elapsed_ms(t0),
    }
    if clarification:
        payload["clarificationRequired"] = True
    return envelope(payload)


@app.post("/api/v1/ai/query-intents", dependencies=[Depends(require_service_token)])
async def query_intents(body: QueryIntentsRequest) -> Dict[str, Any]:
    t0 = time.perf_counter()
    question = body.question.strip()

    metric = _pick_by_longest(question, _METRIC_KW)
    group_by = _pick_by_longest(question, _GROUP_KW)
    operation = _pick_by_longest(question, _OP_KW)
    prod_lines = _extract_prod_lines(question)

    # --- 第五轮 P2：不等价指标优先判（否则会被相近词命中成别的指标）---
    non_eq = _first_unsupported(question, tuple(_NON_EQUIVALENT_METRIC_KW.keys()))
    if non_eq:
        return _intent_unsupported(
            f"暂不支持「{non_eq}」指标：{_NON_EQUIVALENT_METRIC_KW[non_eq]}。{_SUPPORTED_METRIC_HINT}", t0)

    if metric is None:
        return _intent_unsupported(
            f"无法从问题中识别出受支持的指标（metric）。{_SUPPORTED_METRIC_HINT}", t0)

    # --- 第五/六轮：检查**全部**分组要求；复合分组或含不支持维度一律拒绝 ---
    dims = _explicit_grouping_dimensions(question)
    resolved_groups: set = set()
    for d in dims:
        bad_in_dim = _unsupported_group_hit(d)
        if bad_in_dim:
            return _intent_unsupported(
                f"暂不支持按「{bad_in_dim}」分组（groupBy 仅支持 prodLine/date/defectType/device）。", t0)
        keys = _group_keys_in(d)
        if not keys:
            return _intent_unsupported(
                f"无法确定分组维度「{d}」（groupBy 仅支持 prodLine/date/defectType/device）。", t0)
        if len(keys) > 1:
            return _intent_unsupported(
                f"暂不支持复合分组「{d}」（同时涉及 {'、'.join(sorted(keys))}）；"
                "groupBy 一次只能一个维度。", t0)
        resolved_groups |= keys
    if len(resolved_groups) > 1:
        return _intent_unsupported(
            f"暂不支持复合分组（同时按 {'、'.join(sorted(resolved_groups))}）；"
            "groupBy 一次只能一个维度。", t0)

    # --- 第七轮：显式分组构式**优先于**整句关键词猜测；其余维度（如产线）只作过滤 ---
    # 反例：「SMT-2产线按日期统计产量」原先被整句里的"产线"抢占，groupBy 变成 prodLine。
    if len(resolved_groups) == 1:
        group_by = next(iter(resolved_groups))

    # --- 第八轮：**仅在没有明确分组要求时**才把趋势默认到日期分组 ---
    # 有明确分组时必须保留该要求，交给组合矩阵判断是否支持
    # （如「按设备查询产量趋势」「按不良类型查询良品率趋势」→ supported:false）。
    if operation == "trend" and not resolved_groups:
        group_by = "date"
    # 第六轮 P1：**不再**因为"已识别到分组"就跳过整句扫描 ——
    # 「按产线查看操作员的产量」这类句子里，操作员不在构式捕获范围内，仍需拦下。
    bad_group = _unsupported_group_hit(question)
    if bad_group:
        return _intent_unsupported(
            f"暂不支持按「{bad_group}」分组（groupBy 仅支持 prodLine/date/defectType/device）。", t0)

    bad_op = _first_unsupported(question, _UNSUPPORTED_OP_KW)
    if bad_op:
        return _intent_unsupported(
            f"暂不支持「{bad_op}」类操作（operation 仅支持 list/trend/minimum/maximum）。", t0)

    # --- 第四轮 P1-4：未知/多产线不得静默丢弃 ---
    unknown_lines = _unknown_prod_lines(question)
    if unknown_lines:
        return _intent_unsupported(
            f"产线「{'、'.join(unknown_lines)}」不存在（可用产线：{'、'.join(sorted(_KNOWN_PROD_LINES))}）。", t0)
    if len(prod_lines) > 1:
        return _intent_unsupported(
            f"暂不支持一次查询多条产线（识别到 {'、'.join(prod_lines)}）；请分开查询。", t0)
    prod_line = prod_lines[0] if prod_lines else None

    if operation is None:
        operation = "list"
    if group_by is None:
        if operation == "trend":
            group_by = "date"
        elif metric == "deviceStatus":
            group_by = "device"
        else:
            group_by = "prodLine"

    # 合法组合矩阵校验（决策 1）
    if not _is_allowed_combo(metric, group_by, operation):
        return _intent_unsupported(
            f"不支持的组合：metric={metric} / groupBy={group_by} / operation={operation}。", t0)

    start_date, end_date, date_status, date_reason = _parse_dates(question, body.dateContext)
    if date_status == "clarification":
        return _intent_unsupported(date_reason, t0, clarification=True)

    # --- S9 审查 P2-3：设备状态仅支持当前快照，不提供历史回放 ---
    # 读当前 device.status 回答历史问题会误导为用户状态 → 提前拒绝并要求重述
    if metric == "deviceStatus" and (start_date != body.dateContext.today
                                    or end_date != body.dateContext.today):
        return _intent_unsupported(
            "设备状态仅支持查询当前快照（本版不提供历史状态回放）；"
            "请用「现在各台设备状态怎么样」提问。",
            t0,
            clarification=True,
        )

    return envelope({
        "supported": True,
        "intent": {
            "metric": metric,
            "groupBy": group_by,
            "startDate": start_date,
            "endDate": end_date,
            "prodLine": prod_line,
            "operation": operation,
        },
        "usage": dict(_ZERO_USAGE),
        "latencyMs": _elapsed_ms(t0),
    })


# =========================================================================
# 3. POST /api/v1/ai/query-answers  （只转述 NestJS 提供的数字）
# =========================================================================
def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _has_value(metric: Optional[str], v: Any) -> bool:
    """按指标类型判断该行是否有有效值（第四轮 P1-5）。

    设备状态（deviceStatus）等**字符串指标**也必须可转述；不能一律要求数字，
    否则合法响应会被误判成「全部为空值」→ no_data。
    """
    if v is None:
        return False
    if isinstance(v, str):
        return bool(v.strip())
    if isinstance(v, bool):
        return True
    return isinstance(v, (int, float))


def _classify_columns(columns: List["ColumnDTO"], metric: str):
    """把非指标列分成「维度」与「辅助数量/比率」（P2-8：三类分开输出，不再拼接）。"""
    dims: List["ColumnDTO"] = []
    aux: List["ColumnDTO"] = []
    for c in columns:
        if c.key == metric:
            continue
        unit = c.unit or ""
        is_ratio = unit == "%" or c.key.endswith("Rate")
        if is_ratio or c.type == "number":
            aux.append(c)
        else:
            dims.append(c)
    return dims, aux


def _build_query_answer(question: str, qr: "QueryResultDTO") -> Dict[str, Any]:
    """只转述 queryResult 中的数字，绝不新增（P2-8 文本结构修正）。"""
    rows = qr.rows or []
    columns = qr.columns or []
    metric = qr.query.metric if qr.query else None

    if not rows:
        return {"answerStatus": "no_data", "answer": "所查询日期没有可用生产数据。"}
    if not metric:
        raise ApiError(10001, "参数错误", {"errors": [{
            "field": "queryResult.query.metric",
            "reason": "存在 rows 时 metric 必填（用于定位指标列）；本服务不猜测指标。",
        }]})

    col_by_key = {c.key: c for c in columns}
    metric_col = col_by_key.get(metric)
    metric_label = metric_col.label if metric_col else "数值"
    metric_unit = (metric_col.unit if metric_col else "") or ""
    dims, aux = _classify_columns(columns, metric)

    # 第三轮 P5 / 第四轮 P1-5：按指标类型判断有效值；全部无有效值 → no_data
    if not [r for r in rows if _has_value(metric, r.get(metric))]:
        return {"answerStatus": "no_data",
                "answer": f"所查询范围内「{metric_label}」全部为空值，无可用数据。"}

    def _dim_text(row: Dict[str, Any]) -> str:
        return "，".join(f"{c.label} {row.get(c.key)}" for c in dims
                        if row.get(c.key) is not None)

    def _aux_text(row: Dict[str, Any]) -> str:
        parts = []
        for c in aux:
            v = row.get(c.key)
            if v is None:
                continue
            parts.append(f"{c.label} {_fmt_num(v)}{c.unit or ''}")
        return "，".join(parts)

    def _row_text(row: Dict[str, Any]) -> str:
        seg = []
        dim = _dim_text(row)
        if dim:
            seg.append(dim)
        v = row.get(metric)
        seg.append(f"{metric_label} 无数据" if not _has_value(metric, v)
                   else f"{metric_label} {_fmt_num(v)}{metric_unit}")
        text = " ".join(seg)
        extra = _aux_text(row)
        if extra:
            text += f"（{extra}）"
        return text

    op = None
    if any(k in question for k in ("最低", "最少", "最小")):
        op = "minimum"
    elif any(k in question for k in ("最高", "最多", "最大")):
        op = "maximum"

    numeric = [r for r in rows if _is_number(r.get(metric))]
    picked = None
    if op and numeric:
        picked = min(numeric, key=lambda r: r[metric]) if op == "minimum" \
            else max(numeric, key=lambda r: r[metric])

    if picked is not None:
        head = "最低" if op == "minimum" else "最高"
        answer = f"{_row_text(picked)}，为所查询范围{head}。"
    else:
        answer = "查询结果：" + "；".join(_row_text(r) for r in rows) + "。"

    notes = []
    if "直通率" in question:
        notes.append("当前系统只支持「报工良品率」，不支持真实直通率（FPY）")
    if metric == "goodRate":
        notes.append("报工良品率不等同于真实 FPY")
    elif metric == "completionRate":
        notes.append("累计完成率＝末道工序累计良品÷计划总数，非当日产量÷当日计划")
    if notes:
        answer += "（说明：" + "；".join(notes) + "。）"

    return {"answerStatus": "answered", "answer": answer}


@app.post("/api/v1/ai/query-answers", dependencies=[Depends(require_service_token)])
async def query_answers(body: QueryAnswersRequest) -> Dict[str, Any]:
    t0 = time.perf_counter()
    qr = _validate_nested(QueryResultDTO, body.queryResult, "queryResult")
    built = _build_query_answer(body.question.strip(), qr)
    # 决策 3：mode 反映本服务实际执行路径——问数文本为确定性组装，未调用模型 → local
    return envelope({
        "answerStatus": built["answerStatus"],
        "answer": built["answer"],
        "mode": "local",
        "degraded": False,
        "usage": dict(_ZERO_USAGE),
        "latencyMs": _elapsed_ms(t0),
    })


# =========================================================================
# 4. POST /api/v1/ai/root-cause-analyses
# =========================================================================
# evidence 为决策 6 的 {type, resourceId, ref, fact} 四字段结构（EvidenceItem 已强制）。
_EV_CATEGORY_KW = (
    ("device", ("device", "设备", "equipment")),
    ("quality", ("quality", "defect", "inspection", "检验", "不良", "质量", "qc")),
    ("delivery", ("order", "delivery", "交付", "订单", "工单", "progress", "进度", "完成")),
    ("material", ("batch", "material", "物料", "批次")),
)


def _ev_category(ev: "EvidenceItem") -> str:
    blob = f"{ev.type} {ev.fact}".lower()
    for cat, kws in _EV_CATEGORY_KW:
        if any(k in blob for k in kws):
            return cat
    return "other"


def _cause_text(category: str, items: List["EvidenceItem"]) -> str:
    """只用证据里真实存在的 fact/resourceId 组织「可能原因」，绝不补造事实（P1-5）。

    - 只陈述证据事实本身，外加"可能…"的假设性推断；不臆测证据未提供的状态/数值。
    - 每类证据产出一条原因，evidenceRefs 使用证据自带的 ref（可定位）。
    """
    refs = "、".join(dict.fromkeys(i.resourceId for i in items))
    facts = "；".join(dict.fromkeys(i.fact for i in items))
    if category == "device":
        return f"设备 {refs} 的资料记载：{facts}。可能影响相关产线产能。"
    if category == "quality":
        return f"质量数据 {refs}：{facts}。可能与本次质量预警相关。"
    if category == "delivery":
        return f"进度数据 {refs}：{facts}。可能存在订单延期风险。"
    if category == "material":
        return f"物料批次 {refs}：{facts}。可能存在来料波动。"
    return f"关联数据 {refs}：{facts}。可能与本次预警相关。"


# 证据极性判定（第三轮 P6）：只有**异常侧**证据才允许生成原因假设。
_ABNORMAL_KW = ("故障", "异常", "维修", "停机", "超差", "不良", "偏低", "低于", "超标",
                "报警", "失效", "缺料", "缺件", "延迟", "延期", "未完成", "待机", "偏差", "波动")
_NORMAL_KW = ("正常", "运行中", "无异常", "无故障", "未见异常", "未发现异常", "未发现", "合格",
              "达标", "符合", "ok", "normal")
# 否定式：「无异常」「未发生故障」里的"异常/故障"不算异常；「不正常/不合格」算异常
_NEG_ABNORMAL_RE = re.compile(
    r"(无|没有|未|未见|未发现|不存在|未出现|未发生|未曾|并无|从未)\s*[\u4e00-\u9fff]{0,3}"
    r"(异常|故障|报警|停机|不良|超差|偏差|缺陷|缺料|缺件|返工|报废)")
_NEG_NORMAL_RE = re.compile(r"(不|非)\s*正常|(不|未)\s*合格|(未|不)\s*达标|(不|未)\s*符合")
# 零异常事实：「不良数量为0」「异常0次」「停机0台」→ 属正常，不是异常
_ZERO_ABNORMAL_RE = re.compile(
    r"(异常|故障|停机|不良|报警|超差|偏差|缺陷|缺料|缺件|返工|报废)[^，。；、]{0,8}?"
    r"(为|是|=|等于|:|：)?\s*0\s*(件|个|次|台|条|起|批|%|台次)?"
    r"|0\s*(件|个|次|台|条|起|批)?\s*(异常|故障|停机|不良|报警|超差|偏差|缺陷)")


def _ev_polarity(ev: "EvidenceItem") -> str:
    """把一条证据判为 abnormal / normal / neutral（只看 fact，避免臆测）。

    第四轮 P1-6：先剥离**否定式**（`未发生故障`）与**零异常事实**（`不良数量为0`），
    再匹配异常词 —— 不能仅凭"故障/不良"字面出现就生成原因假设。
    """
    fact = (ev.fact or "").lower()
    stripped = _ZERO_ABNORMAL_RE.sub("", _NEG_ABNORMAL_RE.sub("", fact))
    if _NEG_NORMAL_RE.search(stripped) or any(k in stripped for k in _ABNORMAL_KW):
        return "abnormal"
    if _ZERO_ABNORMAL_RE.search(fact) or _NEG_ABNORMAL_RE.search(fact) \
            or any(k in fact for k in _NORMAL_KW):
        return "normal"
    return "neutral"


def _suggestion_for(alert: "AlertItem", has_evidence: bool, no_anomaly: bool = False) -> str:
    atype = str(alert.type or "")
    if no_anomaly:
        return ("证据未显示异常，建议维持现有监控；如仍有预警，请补充异常侧证据"
                "（设备状态变更、不良明细、物料批次）后再分析。")
    if not has_evidence:
        return "建议先补充关联证据（设备状态、检验记录、物料批次等）后再进行根因分析。"
    if any(k in atype for k in ("质量", "不良")):
        return "建议质检员复核该时段不良类型与检验记录，并追溯相关物料批次。"
    if any(k in atype for k in ("交付", "延期", "进度", "完成")):
        return "建议计划员核对剩余工单的后续工序计划与可用产能，必要时调整排产。"
    if any(k in atype for k in ("设备",)):
        return "建议设备负责人检查该设备状态并反馈恢复时间。"
    return "建议负责人核查上述关联证据后人工确认处置方案。"


@app.post("/api/v1/ai/root-cause-analyses", dependencies=[Depends(require_service_token)])
async def root_cause_analyses(body: RootCauseRequest) -> Dict[str, Any]:
    t0 = time.perf_counter()
    evidence = body.evidence or []

    abnormal = [ev for ev in evidence if _ev_polarity(ev) == "abnormal"]
    normal = [ev for ev in evidence if _ev_polarity(ev) == "normal"]

    # 第三轮 P6：只有异常侧证据才生成可能原因；正常/中性证据不得产生原因假设
    by_cat: Dict[str, List[EvidenceItem]] = {}
    for ev in abnormal:
        by_cat.setdefault(_ev_category(ev), []).append(ev)

    possible_causes: List[Dict[str, Any]] = [
        {
            "text": _cause_text(cat, items),
            "evidenceRefs": list(dict.fromkeys(i.ref for i in items)),
        }
        for cat, items in by_cat.items()
    ]

    if possible_causes:
        analysis_status = "hypothesis"
        suggestion = _suggestion_for(body.alert, True)
    elif evidence and normal and not abnormal:
        # 证据显示正常：无异常可分析
        analysis_status = "no_anomaly"
        suggestion = _suggestion_for(body.alert, True, no_anomaly=True)
    else:
        analysis_status = "insufficient_evidence"
        suggestion = _suggestion_for(body.alert, False)

    mode = "local"
    degraded = False
    usage = dict(_ZERO_USAGE)

    if LLM_ENABLED and possible_causes:
        # P2 整改：若配置了大模型，调用 LLM 对处置建议进行深化分析；失败/超时自动回退 local (degraded=True)
        llm = rag.LLMClient()
        if llm.enabled:
            system_prompt = (
                "你是精创电子 MES 系统的质量与设备专家 AI 助手。"
                "请根据给定的预警事实及关联证据，对根因进行专业分析并提供切实可行的现场处置建议。"
                "必须严格基于所给证据事实，不得臆造任何不存在的数据或部件。回答简洁客观，中文。"
            )
            evidence_lines = "\n".join(f"- [{e.ref}] {e.fact}" for e in evidence)
            user_prompt = (
                f"预警对象：{body.alert.title}（类型：{body.alert.type}，等级：{body.alert.level}）\n"
                f"关联证据：\n{evidence_lines}\n"
                f"初筛原因：\n" + "\n".join(f"- {c['text']}" for c in possible_causes) + "\n"
                f"请输出一段简要的现场处置建议（50字以内）。"
            )
            try:
                llm_res = await asyncio.wait_for(
                    asyncio.to_thread(llm.chat_full, system_prompt, user_prompt),
                    timeout=LLM_TIMEOUT_SECONDS + 1.0,
                )
                if llm_res and isinstance(llm_res.get("usage"), dict):
                    usage = dict(llm_res["usage"])
                raw_content = (llm_res.get("content") or "").strip() if llm_res else ""
                if not raw_content:
                    # P2 整改：空模型回答回退 local 并标记降级（保留已产生用量）
                    degraded = True
                    mode = "local"
                else:
                    mode = "llm"
                    suggestion = raw_content
            except Exception:
                degraded = True
                mode = "local"

    result: Dict[str, Any] = {
        "possibleCauses": possible_causes,
        "suggestion": suggestion,
        "analysisStatus": analysis_status,
        "mode": mode,
        "degraded": degraded,
        "usage": usage,
        "latencyMs": _elapsed_ms(t0),
    }
    if analysis_status == "no_anomaly":
        facts = "；".join(dict.fromkeys(ev.fact for ev in normal))
        result["explanation"] = (f"证据显示相关对象运行正常（{facts}），未发现异常，"
                                 "无可分析的根因，不生成原因假设。")
    elif analysis_status == "insufficient_evidence":
        if not evidence:
            result["explanation"] = "未提供可定位的关联证据（type/resourceId/ref/fact），无法形成根因假设。"
        else:
            result["explanation"] = ("提供的证据均为中性事实，不支持异常判断，无法形成根因假设"
                                     "（不凑条数、不猜引用）。")
    return envelope(result)


# =========================================================================
# 5. POST /api/v1/ai/daily-reports
# =========================================================================
# 参与「Σ各产线 = 顶层权威汇总」一致性校验的数量字段（P1-2）
_SUM_FIELDS = ("planQty", "planTotalQty", "doneQty", "outputQty", "goodQty", "badQty")
# 判定「是否有业务数据」的关键指标
_KEY_METRICS = ("outputQty", "doneQty", "goodQty", "badQty")


def _num(v: Any) -> Optional[float]:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _fmt_rate(v: Any) -> str:
    n = _num(v)
    return "无数据" if n is None else f"{float(n):.2f}%"


def _fmt_qty(v: Any, unit: str = "件") -> str:
    n = _num(v)
    return "无数据" if n is None else f"{_fmt_num(n)}{unit}"


def _check_consistency(agg: Dict[str, Any], lines: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Σ各产线 与 顶层权威汇总 若均可比且不等 → 报不一致（P1-2：不自行改数）。"""
    problems: List[Dict[str, str]] = []
    if not lines:
        return problems
    for field in _SUM_FIELDS:
        agg_val = _num(agg.get(field))
        if agg_val is None:
            continue
        line_vals = [_num(ln.get(field)) for ln in lines]
        if any(v is None for v in line_vals):
            continue
        total = sum(line_vals)
        if total != agg_val:
            problems.append({
                "field": f"metrics.metrics.{field}",
                "reason": (f"顶层汇总({_fmt_num(agg_val)}) 与各产线之和({_fmt_num(total)}) 不一致；"
                           "本服务原样透传 NestJS 快照、不自行改数，请核对聚合口径。"),
            })
    return problems


def _verify_daily_report_metrics(text: str, agg: Dict[str, Any], date_str: str, alerts_count: int) -> bool:
    """事实校验：校验大模型生成的生产日报文本中的数字是否与快照一致，严禁篡改或编造矛盾数字。"""
    if not text or not text.strip():
        return False

    def _num(v: Any) -> Optional[float]:
        try:
            return float(v) if v is not None and not isinstance(v, bool) else None
        except (ValueError, TypeError):
            return None

    # 1. 累计完成率校验 (completionRate)
    comp_rate = _num(agg.get("completionRate"))
    for m in re.finditer(r"(?:累计完成率|达成率|完成率|累计达成率)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if comp_rate is not None and abs(val - comp_rate) > 0.05:
            return False

    # 2. 报工良品率校验 (goodRate)
    good_rate = _num(agg.get("goodRate"))
    for m in re.finditer(r"(?:报工良品率|良品率|合格率|报工合格率)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if good_rate is not None and abs(val - good_rate) > 0.05:
            return False

    # 3. 计划指标校验：总计划 vs 日计划（严格前缀隔离，严防“总排产计划”与“排产计划”重叠）
    plan_total = _num(agg.get("planTotalQty"))
    plan_day = _num(agg.get("planQty"))

    # 总计划 (planTotalQty)
    for m in re.finditer(r"(?:计划总数|总计划|累计计划|计划总量|总计划数|总排产计划|总排产)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if plan_total is not None and abs(val - plan_total) > 0.01:
            return False

    # 单日排产计划 (planQty：负向断言排查“总”或“累计”)
    for m in re.finditer(r"(?<![总累计])(?:当日计划|单日计划|今日计划|本日计划|日计划|排产计划|当日排产|单日排产|今日排产|本日排产)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if plan_day is not None and abs(val - plan_day) > 0.01:
            return False

    # 4. 良品/合格品指标校验（严格区分累计与单日口径）
    done_qty = _num(agg.get("doneQty"))
    good_qty = _num(agg.get("goodQty"))

    # 明确累计良品 / 累计合格品
    for m in re.finditer(r"(?:累计(?:生产|完成)?(?:良品|合格品?)|良品总数|合格总数|总(?:良品|合格品?)|累计(?:良品|合格)量|累计(?:良品|合格)数)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if done_qty is not None and abs(val - done_qty) > 0.01:
            return False

    # 明确当日良品 / 当日合格品
    for m in re.finditer(r"(?:(?:当日|单日|今日|本日)(?:生产|产出)?(?:良品|合格品?)|产出(?:良品|合格品?)|其中(?:良品|合格品?)|(?:当日|单日|今日|本日)(?:良品|合格)数|(?:当日|单日|今日|本日)(?:良品|合格)量)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if good_qty is not None and abs(val - good_qty) > 0.01:
            return False

    # 泛称良品（严防把“不良品”中的“良品”当作良品）
    for m in re.finditer(r"(?<![不累计总单日今本日其中产出])(?:良品|合格品?)(?!率)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        allowed_goods = [g for g in (done_qty, good_qty) if g is not None]
        if allowed_goods and not any(abs(val - g) <= 0.01 for g in allowed_goods):
            return False

    # 5. 单日产出量校验（覆盖“当日共生产”、“当日共完成...生产”等丰富表达）
    output_qty = _num(agg.get("outputQty"))

    # 当日/单日生产或产出表达
    for m in re.finditer(r"(?:当日|单日|今日|本日)[^0-9%率]{0,6}(?:共)?(?:生产|产出|产量|完成|报工)[^0-9%率良品合格不良计划排产]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if output_qty is not None and abs(val - output_qty) > 0.01:
            return False

    # 标准产出量指标词
    for m in re.finditer(r"(?:产出总量|产出量|产出数|生产总量|生产量|生产数|报工总量|报工数)(?![良品合格不良计划排产])[^0-9%率良品合格不良计划排产]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if output_qty is not None and abs(val - output_qty) > 0.01:
            return False

    # 单独的 '产出'（排除累计/总，排除后接良品/合格/不良/计划）
    for m in re.finditer(r"(?<![累计总])产出(?![良品合格不良计划排产日报指标])[^0-9%率良品合格不良计划排产]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if output_qty is not None and abs(val - output_qty) > 0.01:
            return False

    # 6. 不受快照支持的累计产出指标校验（快照无累计产出字段，禁止将累计产出/总产出宣称为任何数字）
    for m in re.finditer(r"(?:累计产出|总产出|累计产量|总产量|累计总产出|累计总产量)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        return False

    # 7. 不良数指标校验
    bad_qty = _num(agg.get("badQty"))
    for m in re.finditer(r"(?:不良品|不良数|不良件|当日不良|单日不良|今日不良|本日不良|其中不良)[^0-9%率]{0,6}(\d+(?:\.\d+)?)", text):
        val = float(m.group(1))
        if bad_qty is not None and abs(val - bad_qty) > 0.01:
            return False

    # 8. 预警数校验
    for m in re.finditer(r"(?:预警|告警)[^0-9]{0,6}(\d+(?:\.\d+)?)条?", text):
        val = float(m.group(1))
        if abs(val - alerts_count) > 0.01:
            return False

    # 9. 百分比率防编造校验
    valid_rates = {100.0, 0.0}
    if comp_rate is not None:
        valid_rates.add(comp_rate)
    if good_rate is not None:
        valid_rates.add(good_rate)

    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*%", text):
        try:
            fn = float(m.group(1))
            if not any(abs(fn - vr) < 0.05 for vr in valid_rates):
                return False
        except ValueError:
            pass

    # 10. 严格生产件数单位防编造与未识别指标校验
    # 凡带有“件/个/支/箱/PCS/pcs/台”的数量，必须符合其上下文指标定义
    for m in re.finditer(r"([^\d\n，。；！？]{0,12})?(\d+(?:\.\d+)?)\s*(?:件|个|支|箱|PCS|pcs|台)([^\d\n，。；！？]{0,8})?", text):
        prefix = m.group(1) or ""
        suffix = m.group(3) or ""
        ctx = prefix + suffix
        fn = float(m.group(2))

        # 检查该数字在上下文中是否属于有效指标
        # A. 计划总数 (100)
        is_plan_total = any(k in ctx for k in ("计划总数", "总计划", "累计计划", "计划总量", "总排产计划", "总排产"))
        if is_plan_total:
            if plan_total is None or abs(fn - plan_total) > 0.01:
                return False
            continue

        # B. 当日计划 (10)
        is_plan_day = any(k in ctx for k in ("当日计划", "单日计划", "今日计划", "本日计划", "日计划", "排产计划", "当日排产", "单日排产"))
        if is_plan_day:
            if plan_day is None or abs(fn - plan_day) > 0.01:
                return False
            continue

        # C. 累计良品 (76)
        is_done = any(k in ctx for k in ("累计良品", "累计合格", "良品总数", "合格总数", "总良品", "总合格", "累计完成良品", "累计生产良品"))
        if is_done:
            if done_qty is None or abs(fn - done_qty) > 0.01:
                return False
            continue

        # D. 当日良品 (26)
        is_good = any(k in ctx for k in ("当日良品", "单日良品", "今日良品", "本日良品", "产出良品", "其中良品", "当日合格", "单日合格", "今日合格", "本日合格"))
        if is_good:
            if good_qty is None or abs(fn - good_qty) > 0.01:
                return False
            continue

        # E. 当日产出 (30)
        is_output = any(k in ctx for k in ("当日产出", "单日产出", "今日产出", "本日产出", "产出总量", "产出量", "产出数", "当日生产", "单日生产", "今日生产", "本日生产", "生产量", "报工", "生产"))
        if is_output:
            if output_qty is None or abs(fn - output_qty) > 0.01:
                return False
            continue

        # F. 不良品 (4)
        is_bad = any(k in ctx for k in ("不良", "不良品", "不良数", "不良件"))
        if is_bad:
            if bad_qty is None or abs(fn - bad_qty) > 0.01:
                return False
            continue

        # G. 泛称良品或计划
        if "良品" in ctx or "合格" in ctx:
            allowed = [g for g in (done_qty, good_qty) if g is not None]
            if not allowed or not any(abs(fn - g) <= 0.01 for g in allowed):
                return False
            continue

        if "计划" in ctx or "排产" in ctx:
            allowed = [p for p in (plan_total, plan_day) if p is not None]
            if not allowed or not any(abs(fn - p) <= 0.01 for p in allowed):
                return False
            continue

        # 若带件数的数字既不匹配任何已知指标，也不是预警数，直接拒绝（杜绝未识别指标或编造数字）
        if alerts_count is not None and abs(fn - alerts_count) <= 0.01:
            continue

        return False

    # 11. 异常超大数字防捏造校验（>= 1000 且非日期年份的数字必须来自快照数字）
    allowed_big = set()
    for field in ("planQty", "planTotalQty", "doneQty", "outputQty", "goodQty", "badQty"):
        v = _num(agg.get(field))
        if v is not None:
            allowed_big.add(round(v, 2))
            allowed_big.add(int(round(v)))
    for part in re.findall(r"\d+", date_str or ""):
        allowed_big.add(int(part))

    for raw_n in re.findall(r"\d+(?:\.\d+)?", text):
        try:
            fn = float(raw_n)
            if fn >= 1000:
                if not any(abs(fn - bn) < 0.05 for bn in allowed_big):
                    return False
        except ValueError:
            pass

    return True


def _assemble_daily_report(metrics_raw: Dict[str, Any],
                           alerts: List[AlertItem]) -> Dict[str, Any]:
    """日报四段组装：数字**全部原样透传** NestJS 权威快照（P1-2）。"""
    dashboard = _validate_nested(DashboardDTO, metrics_raw, "metrics")
    agg = metrics_raw.get("metrics")
    if not isinstance(agg, dict):
        raise ApiError(10001, "参数错误", {"errors": [{
            "field": "metrics.metrics",
            "reason": "必填：NestJS 权威汇总快照缺失，本服务不自行补数。",
        }]})
    lines_raw = [ln for ln in (metrics_raw.get("lines") or []) if isinstance(ln, dict)]

    problems = _check_consistency(agg, lines_raw)
    if problems:
        raise ApiError(10001, "参数错误", {"errors": problems})

    overview = dict(agg)                       # 原样透传：保留 null 与 calculationStatus
    line_performance = [dict(ln) for ln in lines_raw]

    alerts_out: List[Dict[str, Any]] = []
    # 契约 §4.1：内部接口的 suggestions 为**字符串数组**；
    # 预警关联对象（{alertId,text}）由公开日报 DTO 层（NestJS）组装（第六轮 P1）
    suggestions: List[str] = []
    for a in alerts:
        aid = a.alertId if a.alertId is not None else a.id
        alerts_out.append({
            "alertId": aid,
            "type": a.type,
            "title": a.title,
            "possibleCauses": [c.model_dump() for c in a.possibleCauses],
            "explanation": a.explanation,
            "suggestion": a.suggestion,
            "analysisStatus": a.analysisStatus,
        })
        if a.suggestion:
            suggestions.append(a.suggestion)

    data_source = dashboard.dataSource
    data_label = dashboard.dataLabel
    calc_status = agg.get("calculationStatus")
    has_numbers = any(_num(agg.get(k)) is not None for k in _KEY_METRICS)
    answer_status = "no_data" if (calc_status == "no_data" or not has_numbers) else "answered"

    prefix = f"{data_label}：" if data_source == "demo" and data_label else ""
    if answer_status == "no_data":
        overview_text = (f"{prefix}当日无可用生产数据"
                         f"（calculationStatus={calc_status or 'no_data'}）。")
    else:
        overview_text = (
            f"{prefix}累计完成率{_fmt_rate(agg.get('completionRate'))}，"
            f"累计良品{_fmt_qty(agg.get('doneQty'))}，"
            f"计划总数{_fmt_qty(agg.get('planTotalQty'))}；"
            f"当日产出{_fmt_qty(agg.get('outputQty'))}，"
            f"报工良品率{_fmt_rate(agg.get('goodRate'))}。"
        )

    return {
        "answerStatus": answer_status,
        "overview": overview,
        "overviewText": overview_text,
        "linePerformance": line_performance,
        "alerts": alerts_out,
        "suggestions": suggestions,
        "dataSource": data_source,
        "dataLabel": data_label,
    }


@app.post("/api/v1/ai/daily-reports", dependencies=[Depends(require_service_token)])
async def daily_reports(body: DailyReportRequest) -> Dict[str, Any]:
    t0 = time.perf_counter()
    # P1-1：metrics 为必填（请求模型强制）；**无 demo 分支**，离线演示只在 ai-demo/
    built = _assemble_daily_report(body.metrics, body.alerts)
    mode = "local"
    degraded = False
    usage = dict(_ZERO_USAGE)
    overview_text = built["overviewText"]

    if LLM_ENABLED and built["answerStatus"] != "no_data":
        # P2 整改：若配置了大模型，调用 LLM 润色生产日报综述文本；数字必须原样引用权威快照；失败/超时回退 local (degraded=True)
        llm = rag.LLMClient()
        if llm.enabled:
            system_prompt = (
                "你是精创电子 MES 系统的 AI 生产管理助手。"
                "请根据所提供的当日生产指标数据与预警情况，润色一段生产日报综述（100字左右）。"
                "【严格约束】：所有数值（完成率、良品数、计划数、产出数、良品率等）必须原样引用给定的快照数字，"
                "严禁修改、虚构或四舍五入改变原始数值！回答中文。"
            )
            agg = built["overview"]
            alerts_count = len(built["alerts"])
            user_prompt = (
                f"日期：{body.date}\n"
                f"生产指标快照：累计完成率 {agg.get('completionRate')}%，累计良品 {agg.get('doneQty')}件，"
                f"计划总数 {agg.get('planTotalQty')}件；当日产出 {agg.get('outputQty')}件，"
                f"报工良品率 {agg.get('goodRate')}%。\n"
                f"当日预警数：{alerts_count}条。\n"
                f"参考底稿：{overview_text}"
            )
            try:
                llm_res = await asyncio.wait_for(
                    asyncio.to_thread(llm.chat_full, system_prompt, user_prompt),
                    timeout=LLM_TIMEOUT_SECONDS + 1.0,
                )
                if llm_res and isinstance(llm_res.get("usage"), dict):
                    usage = dict(llm_res["usage"])
                raw_content = (llm_res.get("content") or "").strip() if llm_res else ""
                if not raw_content:
                    # P2 整改：空模型回答回退 local 并标记降级（保留已产生用量）
                    degraded = True
                    mode = "local"
                elif not _verify_daily_report_metrics(raw_content, built["overview"], body.date, len(built["alerts"])):
                    # P2 整改：事实校验失败（数字矛盾或口径篡改），拒绝矛盾文本并回退 local (degraded=True，保留已产生用量)
                    degraded = True
                    mode = "local"
                else:
                    mode = "llm"
                    overview_text = raw_content
            except Exception:
                degraded = True
                mode = "local"

    payload = dict(built)
    payload["overviewText"] = overview_text
    if isinstance(payload.get("overview"), dict):
        payload["overview"]["text"] = overview_text
    payload["date"] = body.date
    payload["mode"] = mode
    payload["degraded"] = degraded
    payload["usage"] = usage
    payload["latencyMs"] = _elapsed_ms(t0)
    # snapshotAt 已为必填（第四轮 P2-7）
    payload["snapshotAt"] = body.snapshotAt
    return envelope(payload)


# =========================================================================
# 6. GET /health 与 GET /api/v1/health（运维检查）
# =========================================================================
def _health_payload() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": VERSION,
        "uptimeSeconds": int(time.time() - STARTED_AT),
        "timestamp": _now_iso(),
        "knowledge": {"chunks": len(_KB_DOCS), "source": "knowledge.json"},
        "llm": {
            "configured": LLM_ENABLED,
            "mode": "llm" if LLM_ENABLED else "local",
            "model": LLM_MODEL or None,
            "timeoutSeconds": LLM_TIMEOUT_SECONDS,
        },
        "rag": {"minScore": RAG_MIN_SCORE, "minResidue": RAG_MIN_RESIDUE,
                "chunks": len(_KB_DOCS), "prodLines": sorted(_KNOWN_PROD_LINES)},
        "rateLimit": {"perMinute": RATE_LIMIT_PER_MINUTE, "enforced": False},
        # 令牌来源：仅进程环境变量（.env 不参与），不回显令牌内容
        "auth": {"serviceTokenConfigured": bool(AI_SERVICE_TOKEN),
                 "tokenSource": "process-env:AI_SERVICE_TOKEN"},
    }


@app.get("/health")
async def health_root() -> Dict[str, Any]:
    return envelope(_health_payload())


@app.get("/api/v1/health")
async def health_v1() -> Dict[str, Any]:
    return envelope(_health_payload())


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
