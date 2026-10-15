"""S9 F3 智能问数专项测试：意图解析（示例问题白名单）与回答生成（只转述数字）。

覆盖（docs/api-contract.md §4.1 / §7.1 / 需求 §四 F3 示例问题）：
- 4 个示例问题的意图解析（含"直通率→报工良品率"、"这周→本周一至今天"）
- 近 7 天趋势、未知产线、不支持的指标（设备效率/OEE）、模糊周期、未来日期
- query-answers 只转述 queryResult 数字、空结果 no_data、极值挑选、口径说明
- 内部接口服务令牌 fail-closed

支持 pytest 与零依赖独立运行器（python -B test_s9_query_fixes.py）。
"""
import asyncio
import os
import sys
import inspect
import datetime as dt
from httpx import AsyncClient, ASGITransport

try:
    import pytest
except ImportError:
    pytest = None

if pytest is None:
    class _DummyMark:
        @staticmethod
        def asyncio(f):
            return f

        @staticmethod
        def parametrize(argnames, argvalues):
            def decorator(f):
                if not hasattr(f, "pytestmark"):
                    f.pytestmark = []
                class _Mark:
                    name = "parametrize"
                    args = (argnames, argvalues)
                f.pytestmark.append(_Mark())
                return f
            return decorator

    class _DummyPytest:
        mark = _DummyMark()

        @staticmethod
        def fixture(*args, **kwargs):
            def decorator(f):
                return f
            return decorator

    pytest = _DummyPytest()


class SimpleMonkeyPatch:
    def __init__(self):
        self._patches = []

    def setattr(self, target, name, value):
        orig = getattr(target, name)
        self._patches.append((target, name, orig))
        setattr(target, name, value)

    def undo(self):
        for target, name, orig in reversed(self._patches):
            setattr(target, name, orig)

os.environ["AI_SERVICE_TOKEN"] = "test-token"

import main  # noqa: E402

AUTH = {"Authorization": "Bearer test-token"}
TODAY = "2026-10-13"  # 星期二
THIS_WEEK_MONDAY = "2026-10-12Z"
_THIS_WEEK_MONDAY = "2026-10-12"


def _intent_request(question: str, today: str = TODAY, request_id: str = "req-s9-1"):
    return {
        "question": question,
        "dateContext": {"today": today, "timeZone": "Asia/Shanghai"},
        "userContext": {"userId": "1", "role": "admin"},
        "requestId": request_id,
    }


def _query_result(metric, rows, columns=None, start="2026-10-13", end="2026-10-13",
                  prod_line=None):
    if columns is None:
        columns = [
            {"key": "date", "label": "日期", "type": "string"},
            {"key": metric, "label": "数值", "type": "number"},
        ]
    return {
        "answerStatus": "answered",
        "answer": None,
        "query": {"metric": metric, "startDate": start, "endDate": end, "prodLine": prod_line},
        "columns": columns,
        "rows": rows,
        "sources": [{"resource": "reports", "filters": {"startDate": start, "endDate": end}}],
        "mode": "local",
        "degraded": False,
        "snapshotAt": "2026-10-13T09:00:00+08:00",
        "dataSource": "demo",
        "dataLabel": "演示数据",
    }


def _answer_request(question, query_result, request_id="req-s9-answer"):
    return {
        "question": question,
        "queryResult": query_result,
        "userContext": {"userId": "1", "role": "admin"},
        "requestId": request_id,
    }


async def _post_intents(question, today=TODAY):
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post("/api/v1/ai/query-intents", headers=AUTH,
                             json=_intent_request(question))


async def _post_answers(question, query_result):
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post("/api/v1/ai/query-answers", headers=AUTH,
                             json=_answer_request(question, query_result))


# =========================================================================
# 一、示例问题意图解析（需求 §四 F3 四个示例 + 7 天趋势）
# =========================================================================
@pytest.mark.asyncio
async def test_example1_lowest_good_rate_today():
    """示例1「今天哪条产线直通率最低？」→ goodRate/prodLine/minimum/今天。"""
    res = await _post_intents("今天哪条产线直通率最低？")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"] == {
        "metric": "goodRate",
        "groupBy": "prodLine",
        "startDate": TODAY,
        "endDate": TODAY,
        "prodLine": None,
        "operation": "minimum",
    }
    assert data["usage"] == {"tokensIn": 0, "tokensOut": 0}


@pytest.mark.asyncio
async def test_example2_max_bad_qty_day_this_week():
    """示例2「这周哪天不良品最多？」→ badQty/date/maximum/本周一至今。"""
    res = await _post_intents("这周哪天不良品最多？")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["metric"] == "badQty"
    assert data["intent"]["groupBy"] == "date"
    assert data["intent"]["operation"] == "maximum"
    assert data["intent"]["startDate"] == _THIS_WEEK_MONDAY
    assert data["intent"]["endDate"] == TODAY


@pytest.mark.asyncio
async def test_example3_smt2_completion_rate_trend_this_week():
    """示例3「SMT-2 线这周完成率趋势怎么样？」→ completionRate/date/trend/SMT-2。"""
    res = await _post_intents("SMT-2 线这周完成率趋势怎么样？")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"] == {
        "metric": "completionRate",
        "groupBy": "date",
        "startDate": _THIS_WEEK_MONDAY,
        "endDate": TODAY,
        "prodLine": "SMT-2",
        "operation": "trend",
    }


@pytest.mark.asyncio
async def test_example4_cal1_main_defect_causes():
    """示例4「CAL-1 线的主要不良原因是什么？」→ defectQty/defectType/list/CAL-1/今天。"""
    res = await _post_intents("CAL-1 线的主要不良原因是什么？")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"] == {
        "metric": "defectQty",
        "groupBy": "defectType",
        "startDate": TODAY,
        "endDate": TODAY,
        "prodLine": "CAL-1",
        "operation": "list",
    }


@pytest.mark.asyncio
async def test_seven_day_trend_output_qty():
    """7 天趋势：「近7天每天的产量」→ outputQty/date/trend，区间=today-6..today。"""
    res = await _post_intents("近7天每天的产量趋势")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["metric"] == "outputQty"
    assert data["intent"]["groupBy"] == "date"
    assert data["intent"]["operation"] == "trend"
    assert data["intent"]["startDate"] == "2026-10-07"
    assert data["intent"]["endDate"] == TODAY


@pytest.mark.asyncio
async def test_explicit_iso_dates_range():
    """显式 ISO 日期：「2026-10-01 到 2026-10-03 各天良品数」→ goodQty/date/list。"""
    res = await _post_intents("2026-10-01 到 2026-10-03 各天良品数")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["startDate"] == "2026-10-01"
    assert data["intent"]["endDate"] == "2026-10-03"
    assert data["intent"]["metric"] == "goodQty"


# =========================================================================
# 二、不支持的意图（supported:false，不执行猜测查询）
# =========================================================================
@pytest.mark.asyncio
async def test_unknown_prod_line_rejected():
    """未知产线编号不得静默丢弃。"""
    res = await _post_intents("SMT-999 今天产量多少")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "SMT-999" in data["reason"]


@pytest.mark.asyncio
async def test_multiple_prod_lines_rejected():
    """一次查询多条产线：不支持，不静默只取第一条。"""
    res = await _post_intents("SMT-1 和 SMT-2 今天哪条良品率高")
    data = res.json()["data"]
    assert data["supported"] is False


@pytest.mark.asyncio
async def test_non_equivalent_metric_oee_rejected():
    """设备效率（OEE）不是受支持指标，不得映射到相近指标。"""
    res = await _post_intents("今天设备效率怎么样")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "设备效率" in data["reason"]


@pytest.mark.asyncio
async def test_unsupported_group_dimension_rejected():
    """按操作员分组：超出 groupBy 白名单。"""
    res = await _post_intents("按操作员查看今天的良品数")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "操作员" in data["reason"]


@pytest.mark.asyncio
async def test_ambiguous_period_requires_clarification():
    """「上个月」等无法精确解析的周期：要求澄清，不猜测。"""
    res = await _post_intents("上个月哪天产量最高")
    data = res.json()["data"]
    assert data["supported"] is False
    assert data.get("clarificationRequired") is True


@pytest.mark.asyncio
async def test_future_date_requires_clarification():
    """未来日期不得静默改写成今天。"""
    res = await _post_intents("明天的产量是多少")
    data = res.json()["data"]
    assert data["supported"] is False
    assert data.get("clarificationRequired") is True


@pytest.mark.asyncio
async def test_unsupported_combo_rejected():
    """trend 仅允许 groupBy=date；「按产线的完成率趋势」不支持。"""
    res = await _post_intents("按产线查看这周完成率趋势")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "组合" in data["reason"]


@pytest.mark.asyncio
async def test_device_status_combo():
    """deviceStatus 仅支持 groupBy=device + operation=list。"""
    res = await _post_intents("现在各台设备状态怎么样")
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["metric"] == "deviceStatus"
    assert data["intent"]["groupBy"] == "device"
    assert data["intent"]["operation"] == "list"


# =========================================================================
# 三、query-answers：只转述数字
# =========================================================================
@pytest.mark.asyncio
async def test_answers_transcribes_numbers_only():
    """回答只转述 queryResult 数字，不新增数字；直通率附带口径说明。"""
    rows = [
        {"date": "2026-10-09", "goodRate": 95},
        {"date": "2026-10-10", "goodRate": 99},
    ]
    res = await _post_answers(
        "SMT-3 线这周直通率趋势",
        _query_result("goodRate", rows, columns=[
            {"key": "date", "label": "日期", "type": "string"},
            {"key": "goodRate", "label": "报工良品率", "type": "number", "unit": "%"},
        ], start="2026-10-08", end="2026-10-13", prod_line="SMT-3"),
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["answerStatus"] == "answered"
    assert "95" in data["answer"] and "99" in data["answer"]
    assert "报工良品率不等同于真实 FPY" in data["answer"]
    assert data["mode"] == "local"
    assert data["degraded"] is False
    assert data["usage"] == {"tokensIn": 0, "tokensOut": 0}


@pytest.mark.asyncio
async def test_answers_empty_rows_is_no_data():
    """空 rows → no_data，不编造数值。"""
    res = await _post_answers("今天哪条产线直通率最低", _query_result("goodRate", []))
    data = res.json()["data"]
    assert data["answerStatus"] == "no_data"
    assert "没有可用" in data["answer"]


@pytest.mark.asyncio
async def test_answers_all_null_metric_is_no_data():
    """指标列全部为 null → no_data（不能把 null 当 0）。"""
    rows = [
        {"date": "2026-10-09", "goodRate": None, "dataStatus": "no_data"},
        {"date": "2026-10-10", "goodRate": None, "dataStatus": "no_data"},
    ]
    res = await _post_answers("这周直通率趋势", _query_result("goodRate", rows))
    data = res.json()["data"]
    assert data["answerStatus"] == "no_data"
    assert "全部为空值" in data["answer"]


@pytest.mark.asyncio
async def test_answers_minimum_picks_lowest_row():
    """「最低」问题必须挑选数值最小的行。"""
    rows = [
        {"date": "2026-10-09", "goodRate": 95},
        {"date": "2026-10-10", "goodRate": 99},
    ]
    res = await _post_answers(
        "哪天直通率最低",
        _query_result("goodRate", rows, columns=[
            {"key": "date", "label": "日期", "type": "string"},
            {"key": "goodRate", "label": "报工良品率", "type": "number", "unit": "%"},
        ], start="2026-10-09", end="2026-10-10"),
    )
    data = res.json()["data"]
    assert data["answerStatus"] == "answered"
    assert "最低" in data["answer"]
    assert "2026-10-09" in data["answer"]


@pytest.mark.asyncio
async def test_answers_metric_missing_in_columns_rejected():
    """rows 非空但 query.metric 缺失 → 10001（不猜测指标）。"""
    bad = _query_result("goodRate", [{"date": "2026-10-09", "goodRate": 95}])
    bad["query"]["metric"] = None
    res = await _post_answers("趋势", bad)
    assert res.status_code == 400
    assert res.json()["code"] == 10001


@pytest.mark.asyncio
async def test_answers_completion_rate_note():
    """完成率回答必须带「累计完成率」口径说明。"""
    rows = [{"date": "2026-10-09", "completionRate": 76}]
    res = await _post_answers(
        "SMT-2 线这周完成率趋势",
        _query_result("completionRate", rows, columns=[
            {"key": "date", "label": "日期", "type": "string"},
            {"key": "completionRate", "label": "累计完成率", "type": "number", "unit": "%"},
        ], start="2026-10-08", end="2026-10-13", prod_line="SMT-2"),
    )
    data = res.json()["data"]
    assert data["answerStatus"] == "answered"
    assert "累计完成率" in data["answer"]
    assert "非当日产量÷当日计划" in data["answer"]


@pytest.mark.asyncio
async def test_answers_string_metric_device_status_transcribed():
    """字符串指标（设备状态）也必须可转述，不得误判 no_data。"""
    rows = [
        {"device": "EQP-SMT-006", "deviceStatus": "维修中"},
        {"device": "EQP-SMT-001", "deviceStatus": "运行中"},
    ]
    res = await _post_answers(
        "现在各台设备状态怎么样",
        _query_result("deviceStatus", rows, columns=[
            {"key": "device", "label": "设备", "type": "string"},
            {"key": "deviceStatus", "label": "设备状态", "type": "string"},
        ]),
    )
    data = res.json()["data"]
    assert data["answerStatus"] == "answered"
    assert "维修中" in data["answer"] and "运行中" in data["answer"]


# =========================================================================
# 四、S9 审查 P2 修复回归
# =========================================================================
@pytest.mark.asyncio
async def test_unknown_prod_line_prefix_rejected():
    """P2-2：未知前缀产线编号（XXX-9）不得被静默丢弃为全厂查询。"""
    res = await _post_intents("今天XXX-9线的产量")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "XXX-9" in data["reason"]


@pytest.mark.asyncio
async def test_unknown_prod_line_no_hyphen_form_rejected():
    """P2-2 补充：未知前缀 + 「线」后缀同样拒绝。"""
    res = await _post_intents("ABC-7线今天产量多少")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "ABC-7" in data["reason"]


@pytest.mark.asyncio
async def test_product_code_not_mistaken_as_prod_line():
    """P2-2 防误伤：产品/设备编号（JC-PLC-2001、EQP-SMT-006）不是产线编号。"""
    res = await _post_intents("查询 JC-PLC-2001 今天产量")
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["prodLine"] is None

    res = await _post_intents("查询 EQP-SMT-006 今天产量")
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["prodLine"] is None


@pytest.mark.asyncio
async def test_historical_device_status_rejected():
    """P2-3：历史设备状态查询被拒绝（仅支持当前快照）。"""
    res = await _post_intents("昨天设备状态有哪些")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "当前快照" in data["reason"]


@pytest.mark.asyncio
async def test_today_device_status_allowed():
    """P2-3 边界：当天设备状态查询仍放行。"""
    res = await _post_intents("今天设备状态有哪些")
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["metric"] == "deviceStatus"


@pytest.mark.asyncio
async def test_unsupported_group_device_for_output_qty():
    """P2-4：outputQty/device/list 不再放行（执行器无设备级产量分组）。"""
    res = await _post_intents("按设备列出今天的产量")
    data = res.json()["data"]
    assert data["supported"] is False
    assert "组合" in data["reason"]


@pytest.mark.asyncio
async def test_unsupported_min_max_on_defect_type_and_device():
    """P2-4：minimum/maximum 仅限 prodLine/date；defectType/device 一律拒绝。"""
    for q in ["哪类不良类型数量最少", "哪台设备产量最高"]:
        res = await _post_intents(q)
        data = res.json()["data"]
        assert data["supported"] is False, q
        assert "组合" in data["reason"], q


@pytest.mark.asyncio
async def test_defect_qty_by_prod_line_still_supported():
    """P2-4 边界：defectQty/prodLine/list 仍受支持。"""
    res = await _post_intents("按产线统计不良类型")
    data = res.json()["data"]
    assert data["supported"] is True
    assert data["intent"]["metric"] == "defectQty"
    assert data["intent"]["groupBy"] == "prodLine"


# =========================================================================
# 五、安全边界
# =========================================================================
@pytest.mark.asyncio
async def test_intents_without_service_token_rejected():
    """内部接口缺服务令牌 → 401（fail-closed）。"""
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/v1/ai/query-intents",
                            json=_intent_request("今天产量"))
    assert res.status_code == 401
    assert res.json()["code"] == 20001


@pytest.mark.asyncio
async def test_answers_reject_unknown_extra_field():
    """StrictModel：未知字段一律 10001。"""
    transport = ASGITransport(app=main.app)
    req = _answer_request("趋势", _query_result("goodRate", []))
    req["unexpected"] = "x"
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/v1/ai/query-answers", headers=AUTH, json=req)
    assert res.status_code == 400
    assert res.json()["code"] == 10001


def main_test_runner():
    print("=" * 70)
    print("Running S9 F3 Query Test Suite (Standalone Runner)")
    print("=" * 70)

    test_funcs = [
        (name, obj)
        for name, obj in globals().items()
        if name.startswith("test_") and callable(obj)
    ]

    passed = 0
    failed = 0
    total = 0

    for name, fn in test_funcs:
        total += 1
        mp = SimpleMonkeyPatch()
        try:
            sig = inspect.signature(fn)
            kwargs = {}
            for p in sig.parameters:
                if p == "monkeypatch":
                    kwargs[p] = mp
            if asyncio.iscoroutinefunction(fn):
                asyncio.run(fn(**kwargs))
            else:
                fn(**kwargs)
            passed += 1
            print(f"  [PASS] {name}")
        except Exception as e:
            failed += 1
            print(f"  [FAIL] {name}: {e}")
        finally:
            mp.undo()

    print("=" * 70)
    print(f"Summary: {passed}/{total} passed, {failed} failed.")
    print("=" * 70)
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main_test_runner()
