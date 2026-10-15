import asyncio
import os
import sys
import inspect
from httpx import AsyncClient, ASGITransport

try:
    import pytest
except ImportError:
    pytest = None

if pytest is None:
    class _DummyMark:
        @staticmethod
        def asyncio(f):
            f._is_asyncio_test = True
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
    """轻量 monkeypatch，支持在无 pytest 环境下独立运行测试"""
    def __init__(self):
        self._patches = []

    def setattr(self, target, name, value):
        orig = getattr(target, name)
        self._patches.append((target, name, orig))
        setattr(target, name, value)

    def undo(self):
        for target, name, orig in reversed(self._patches):
            setattr(target, name, orig)

# 设置测试环境变量
os.environ["AI_SERVICE_TOKEN"] = "test-token"
os.environ["AI_BASE_URL"] = "http://mock-llm:8000"
os.environ["AI_API_KEY"] = "mock-key"
os.environ["LLM_BASE_URL"] = "http://mock-llm:8000"
os.environ["LLM_API_KEY"] = "mock-key"

import main
import rag

@pytest.fixture(autouse=True)
def ensure_llm_enabled(monkeypatch):
    monkeypatch.setattr(main, "LLM_ENABLED", True)

@pytest.mark.asyncio
async def test_daily_report_contradictory_numbers_rejected_and_degraded(monkeypatch):
    """P2 验证：LLM 编造矛盾数字（产出999999件、完成率999%）被事实校验拒绝，回退 local 并标记 degraded=True"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": "产出999999件、完成率999%，设备超常发挥。",
            "usage": {"tokensIn": 10, "tokensOut": 15},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json={
                "date": "2026-10-12",
                "metrics": {
                    "startDate": "2026-10-12",
                    "endDate": "2026-10-12",
                    "snapshotAt": "2026-10-12T09:00:00+08:00",
                    "metrics": {
                        "planQty": 14,
                        "planTotalQty": 100,
                        "doneQty": 76,
                        "outputQty": 80,
                        "goodQty": 76,
                        "badQty": 4,
                        "completionRate": 76.0,
                        "goodRate": 95.0,
                        "isTrueFpy": False,
                        "calculationStatus": "available",
                    },
                    "lines": [],
                    "dataSource": "demo",
                    "dataLabel": "演示数据",
                },
                "alerts": [],
                "snapshotAt": "2026-10-12T09:00:00+08:00",
                "userContext": {"userId": "1", "role": "admin"},
                "requestId": "req-t1",
            },
        )
        assert res.status_code == 200
        data = res.json()["data"]
        # 事实校验失败：必须回退为 local 模式，且标记 degraded=True
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert "999999" not in data["overviewText"]
        assert "80件" in data["overviewText"]
        # P2 修复验证：模型已产生用量，降级后必须保留真实用量
        assert data["usage"] == {"tokensIn": 10, "tokensOut": 15}

@pytest.mark.asyncio
async def test_daily_report_empty_llm_response_degraded(monkeypatch):
    """P2 验证：LLM 返回空白文本，回退 local 并标记 degraded=True，真实用量不丢弃"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": "   \n  ",
            "usage": {"tokensIn": 5, "tokensOut": 5},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json={
                "date": "2026-10-12",
                "metrics": {
                    "startDate": "2026-10-12",
                    "endDate": "2026-10-12",
                    "snapshotAt": "2026-10-12T09:00:00+08:00",
                    "metrics": {
                        "planQty": 14,
                        "planTotalQty": 100,
                        "doneQty": 76,
                        "outputQty": 80,
                        "goodQty": 76,
                        "badQty": 4,
                        "completionRate": 76.0,
                        "goodRate": 95.0,
                        "isTrueFpy": False,
                        "calculationStatus": "available",
                    },
                    "lines": [],
                    "dataSource": "demo",
                    "dataLabel": "演示数据",
                },
                "alerts": [],
                "snapshotAt": "2026-10-12T09:00:00+08:00",
                "userContext": {"userId": "1", "role": "admin"},
                "requestId": "req-t2",
            },
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert len(data["overviewText"]) > 0
        # P2 修复验证：模型已产生用量，降级后保留真实用量
        assert data["usage"] == {"tokensIn": 5, "tokensOut": 5}

@pytest.mark.asyncio
async def test_root_cause_empty_llm_response_degraded(monkeypatch):
    """P2 验证：根因分析 LLM 返回空响应，回退 local 并标记 degraded=True，真实用量不丢弃"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": "",
            "usage": {"tokensIn": 5, "tokensOut": 0},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/root-cause-analyses",
            headers={"Authorization": "Bearer test-token"},
            json={
                "alert": {
                    "id": "801",
                    "type": "设备停机",
                    "title": "贴片机故障",
                    "level": "重要",
                },
                "evidence": [
                    {
                        "type": "device",
                        "resourceId": "EQP-SMT-003",
                        "ref": "device:EQP-SMT-003",
                        "fact": "贴片机状态异常：故障停机",
                    }
                ],
                "snapshotAt": "2026-10-12T09:00:00+08:00",
                "userContext": {"userId": "1", "role": "admin"},
                "requestId": "req-t3",
            },
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert len(data["suggestion"]) > 0
        # P2 修复验证：空回复降级依然保留下游 LLM 已消耗用量
        assert data["usage"] == {"tokensIn": 5, "tokensOut": 0}


# =========================================================================
# 审查轮次探针专项测试：指标口径精确绑定、中文数字边界及良品率 100% 验证
# =========================================================================
_CALIBER_TEST_SNAPSHOT = {
    "planQty": 10,
    "planTotalQty": 100,
    "doneQty": 76,
    "outputQty": 30,
    "goodQty": 26,
    "badQty": 4,
    "completionRate": 76.0,
    "goodRate": 100.0,
    "isTrueFpy": False,
    "calculationStatus": "available",
}

def _make_daily_report_request(req_id: str):
    return {
        "date": "2026-10-12",
        "metrics": {
            "startDate": "2026-10-12",
            "endDate": "2026-10-12",
            "snapshotAt": "2026-10-12T09:00:00+08:00",
            "metrics": dict(_CALIBER_TEST_SNAPSHOT),
            "lines": [],
            "dataSource": "demo",
            "dataLabel": "演示数据",
        },
        "alerts": [],
        "snapshotAt": "2026-10-12T09:00:00+08:00",
        "userContext": {"userId": "1", "role": "admin"},
        "requestId": req_id,
    }

@pytest.mark.asyncio
async def test_caliber_swap_rejected_and_usage_retained(monkeypatch):
    """P2 验证：口径互换“累计良品26件，计划总数10件”必须被拒绝降级，且保留用量"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": "累计良品26件，计划总数10件，生产稳步推进。",
            "usage": {"tokensIn": 18, "tokensOut": 12},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-1"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        # 校验失败：拒绝降级为 local，且保留真实用量
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert data["usage"] == {"tokensIn": 18, "tokensOut": 12}
        # 权威底稿数据正确
        assert "累计良品76件" in data["overviewText"]
        assert "计划总数100件" in data["overviewText"]

@pytest.mark.asyncio
async def test_good_qty_caliber_mismatch_rejected(monkeypatch):
    """P2 验证：“当日良品76件”混淆单日与累计良品，必须被拒绝降级，且保留用量"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": "今日运转良好，当日良品76件。",
            "usage": {"tokensIn": 14, "tokensOut": 8},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-2"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert data["usage"] == {"tokensIn": 14, "tokensOut": 8}
        assert "76" in data["overviewText"]  # 底稿中 76 是累计良品

@pytest.mark.asyncio
async def test_chinese_adjacent_number_rejected(monkeypatch):
    """P2 验证：“当日生产999999件”紧邻中文数字必须被无边界抽取识别并拒绝，且保留用量"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": "当日生产999999件，严重超常发力。",
            "usage": {"tokensIn": 20, "tokensOut": 10},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-3"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert data["usage"] == {"tokensIn": 20, "tokensOut": 10}
        assert "999999" not in data["overviewText"]

@pytest.mark.asyncio
async def test_valid_summary_with_100_percent_good_rate_accepted(monkeypatch):
    """P2 验证：数字全部正确且包含“报工良品率100%”的综述文本必须通过校验被接受，不被误拒"""
    valid_text = "2026-10-12生产日报：累计完成率76.00%，累计良品76件，计划总数100件；当日产出30件，当日良品26件，报工良品率100.00%。整体运行平稳。"
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": valid_text,
            "usage": {"tokensIn": 35, "tokensOut": 55},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-4"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        # 校验成功通过：mode 为 llm，degraded 为 False，usage 原样保留，且综述文本为 LLM 润色文本
        assert data["mode"] == "llm"
        assert data["degraded"] is False
        assert data["overviewText"] == valid_text
        assert data["usage"] == {"tokensIn": 35, "tokensOut": 55}

@pytest.mark.asyncio
@pytest.mark.parametrize("mismatched_text", [
    "当日合格品76件，生产正常。",
    "当日合格76件，设备平稳。",
    "累计合格26件，持续推进。",
    "累计合格品26件，按计划执行。",
    "当日产出76件，产线全开。",
    "累计产出30件，达成良好。",
])
async def test_extended_caliber_mismatches_rejected(monkeypatch, mismatched_text):
    """P2 深度验证：合格/产出指标等各种口径错配必须被精准拦截降级"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": mismatched_text,
            "usage": {"tokensIn": 16, "tokensOut": 8},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-mismatch"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert data["usage"] == {"tokensIn": 16, "tokensOut": 8}

@pytest.mark.asyncio
@pytest.mark.parametrize("valid_text", [
    "当日产出30件，产出良品26件，报工良品率100.00%。",
    "当日生产30件，良品26件，达成良好。",
    "生产计划总数100件，当日产出30件，当日良品26件。",
    "累计生产良品76件，计划总数100件，当日产出30件。",
    "累计完成良品76件，计划总数100件，当日产出30件。",
    "累计完成率76.00%，良品76件，计划总数100件；当日产出30件，报工良品率100.00%。",
    "生产日报：今日各产线运行平稳，无设备告警与质量波动，建议在接下来的15天内持续监控。",
])
async def test_extended_valid_texts_accepted(monkeypatch, valid_text):
    """P2 深度验证：包含复合词（生产计划、产出良品、累计生产良品等）及合理叙述的正确文本不被误拒"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": valid_text,
            "usage": {"tokensIn": 25, "tokensOut": 35},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-valid"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "llm"
        assert data["degraded"] is False
        assert data["overviewText"] == valid_text
        assert data["usage"] == {"tokensIn": 25, "tokensOut": 35}


# =========================================================================
# 本轮复审重点修复场景验证：
# 1. 计划总数(100)与单日产出混淆 (“当日共生产100件”、“当日共完成100件生产”) 必须拒绝降级
# 2. 累计产出不受快照支持 (“累计产出76件”) 必须拒绝降级，禁止与累计良品 doneQty 混淆
# 3. “当日产出良品26件，不良品4件” 严防子串误匹配，必须正常通过
# 4. “总排产计划100件” 严防与日计划正则重叠，必须正常通过
# =========================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("mismatched_text", [
    "当日共生产100件",
    "当日共完成100件生产",
    "当日生产100件",
])
async def test_daily_production_plan_total_collision_rejected(monkeypatch, mismatched_text):
    """P2 深度验证：快照当日产出为30、总计划为100时，“当日共生产100件”等错配必须被拦截降级，不能凭100在计划字段出现过就放过"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": f"{mismatched_text}，产线效率较高。",
            "usage": {"tokensIn": 16, "tokensOut": 12},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-daily-prod-mismatch"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert data["usage"] == {"tokensIn": 16, "tokensOut": 12}


@pytest.mark.asyncio
@pytest.mark.parametrize("unsupported_text", [
    "累计产出76件",
    "总产出76件",
    "累计产量76件",
    "总产量76件",
    "累计总产出76件",
])
async def test_unsupported_cumulative_output_rejected(monkeypatch, unsupported_text):
    """P2 深度验证：快照无累计产出字段，doneQty为累计良品，禁止将累计产出绑定为76件等任何数字"""
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": f"今日生产总结，{unsupported_text}，持续跟进。",
            "usage": {"tokensIn": 18, "tokensOut": 10},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-cum-output"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "local"
        assert data["degraded"] is True
        assert data["usage"] == {"tokensIn": 18, "tokensOut": 10}


@pytest.mark.asyncio
async def test_good_and_bad_qty_not_falsely_rejected(monkeypatch):
    """P2 深度验证：“当日产出良品26件，不良品4件”不能把“不良品4”误匹配为“良品4”，必须正常通过"""
    valid_text = "生产日报：当日产出良品26件，不良品4件，运行平稳。"
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": valid_text,
            "usage": {"tokensIn": 22, "tokensOut": 28},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-good-bad"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "llm"
        assert data["degraded"] is False
        assert data["overviewText"] == valid_text
        assert data["usage"] == {"tokensIn": 22, "tokensOut": 28}


@pytest.mark.asyncio
async def test_total_scheduled_plan_not_falsely_rejected(monkeypatch):
    """P2 深度验证：“总排产计划100件”不能与日排产计划正则冲突，必须正常通过"""
    valid_text = "总排产计划100件，当日产出30件，当日良品26件，不良品4件。"
    def mock_chat_full(self, system_prompt, user_prompt):
        return {
            "content": valid_text,
            "usage": {"tokensIn": 24, "tokensOut": 32},
        }

    monkeypatch.setattr(rag.LLMClient, "chat_full", mock_chat_full)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/ai/daily-reports",
            headers={"Authorization": "Bearer test-token"},
            json=_make_daily_report_request("req-probe-total-plan"),
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["mode"] == "llm"
        assert data["degraded"] is False
        assert data["overviewText"] == valid_text
        assert data["usage"] == {"tokensIn": 24, "tokensOut": 32}


def main_test_runner():
    """独立测试运行器：当无 pytest 时，支持通过 python -B test_s8_fixes.py 直接完整执行所有测试"""
    print("=" * 70)
    print("Running S8 Test Suite (Standalone Runner, zero external test framework required)")
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
        marks = [m for m in getattr(fn, "pytestmark", []) if getattr(m, "name", None) == "parametrize"]
        param_cases = []
        if marks:
            mark = marks[0]
            argnames, argvalues = mark.args
            for val in argvalues:
                param_cases.append((argnames, val))
        else:
            param_cases.append((None, None))

        for p_name, p_val in param_cases:
            total += 1
            case_title = f"{name}[{p_val}]" if p_val is not None else name
            mp = SimpleMonkeyPatch()
            mp.setattr(main, "LLM_ENABLED", True)
            try:
                sig = inspect.signature(fn)
                kwargs = {}
                if "monkeypatch" in sig.parameters:
                    kwargs["monkeypatch"] = mp
                if p_name and p_name in sig.parameters:
                    kwargs[p_name] = p_val
                if asyncio.iscoroutinefunction(fn):
                    asyncio.run(fn(**kwargs))
                else:
                    fn(**kwargs)
                passed += 1
                print(f"  [PASS] {case_title}")
            except Exception as e:
                failed += 1
                print(f"  [FAIL] {case_title}: {e}")
            finally:
                mp.undo()

    print("=" * 70)
    print(f"Summary: {passed}/{total} passed, {failed} failed.")
    print("=" * 70)
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main_test_runner()



