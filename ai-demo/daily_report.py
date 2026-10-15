#!/usr/bin/env python3
"""AI 生产日报（纯标准库）。
- gen_demo_day()：基于真实主数据（产品/产线/设备）生成带种子的演示日数据，
  明确标注为演示数据。真实上线时替换为从 MySQL 读取的真实报工/检验/设备数据。
- render()：模板渲染日报；配置 AI Key 后可调用大模型润色。
"""
import datetime
import json
import os
import random

from rag import LLMClient

BASE = os.path.dirname(os.path.abspath(__file__))

# 真实主数据（来自企业数据文件）
LINES = [
    ("SMT-1线", "一车间", "JC-PLC-2001", "PLC控制板卡-标准型", 1200),
    ("SMT-2线", "一车间", "JC-PLC-2002", "PLC控制板卡-增强型", 800),
    ("SMT-3线", "一车间", "JC-IoT-4G-A", "4G通信模组-A型", 1500),
    ("ASSY-1线", "二车间", "JC-PLC-2001", "PLC控制板卡-标准型", 1000),
    ("ASSY-2线", "二车间", "JC-IoT-5G-A", "5G通信模组-A型", 600),
    ("CAL-1线", "三车间", "JC-SEN-T100", "温度传感器", 400),
    ("CAL-2线", "三车间", "JC-SEN-P100", "压力传感器", 350),
]
DEVICES = {
    "SMT-1线": ["DEK锡膏印刷机", "贴片机(松下NPM)", "回流焊炉(劲拓)", "AOI检测仪(欧姆龙)"],
    "SMT-2线": ["DEK锡膏印刷机", "贴片机(松下NPM)", "回流焊炉(劲拓·维修中)", "AOI检测仪(欧姆龙)"],
    "SMT-3线": ["点胶机(武藏)", "固化炉"],
    "ASSY-1线": ["波峰焊机(日东)", "功能测试台"],
    "ASSY-2线": ["组装台", "老化房"],
    "CAL-1线": ["标定台", "校准仪(福禄克)"],
    "CAL-2线": ["标定台", "校准仪(福禄克)"],
}
DEFECTS = ["虚焊", "错件", "锡珠", "划伤", "功能不良", "标定超差"]


def gen_demo_day(date=None, seed=42):
    """生成演示日数据。seed 固定保证每次演示结果一致。"""
    rnd = random.Random(seed)
    date = date or datetime.date.today().isoformat()
    lines = []
    for name, ws, pcode, pname, plan in LINES:
        actual = int(plan * rnd.uniform(0.85, 1.02))
        bad_rate = rnd.uniform(0.008, 0.045)
        bad = int(actual * bad_rate)
        good = actual - bad
        fpy = good / actual if actual else 0
        defect = rnd.choice(DEFECTS)
        dev_note = ""
        for d in DEVICES[name]:
            if "维修中" in d:
                dev_note = d.replace("·维修中", "") + "维修中"
        lines.append({
            "line": name, "workshop": ws, "product": f"{pcode} {pname}",
            "plan": plan, "actual": actual, "good": good, "bad": bad,
            "fpy": round(fpy * 100, 1), "top_defect": defect,
            "device_note": dev_note,
        })
    total_plan = sum(l["plan"] for l in lines)
    total_actual = sum(l["actual"] for l in lines)
    total_bad = sum(l["bad"] for l in lines)
    avg_fpy = round(sum(l["good"] for l in lines) / total_actual * 100, 1)
    # 预警规则
    alerts = []
    for l in lines:
        if l["fpy"] < 97:
            alerts.append(("质量", f"{l['line']} 直通率 {l['fpy']}% 低于97%红线，"
                           f"主要不良：{l['top_defect']}（{l['bad']}件）"))
        if l["actual"] < l["plan"] * 0.9:
            alerts.append(("交付", f"{l['line']} 完成率仅 {round(l['actual']/l['plan']*100)}%，"
                           "存在订单延期风险"))
        if l["device_note"]:
            alerts.append(("设备", f"{l['line']} {l['device_note']}，"
                           "注意产能缺口"))
    return {
        "date": date,
        "demo": True,
        "lines": lines,
        "summary": {
            "total_plan": total_plan, "total_actual": total_actual,
            "total_bad": total_bad, "avg_fpy": avg_fpy,
            "completion": round(total_actual / total_plan * 100, 1),
        },
        "alerts": alerts,
    }


REPORT_TEMPLATE = """# 精创电子 · 生产日报（{date}）

> 数据来源：演示数据（基于真实产品/产线/设备主数据模拟）。真实上线后替换为 MES 实时数据。

## 一、今日总览

- 计划产量：{total_plan} 件，实际完成：{total_actual} 件，**完成率 {completion}%**
- 不良品：{total_bad} 件，**平均直通率 {avg_fpy}%**
- 开线：{n_lines} 条产线，{n_workshops} 个车间

## 二、产线表现

| 产线 | 产品 | 计划 | 实际 | 良品 | 不良 | 直通率 | 主要不良 |
|------|------|------|------|------|------|--------|----------|
{rows}

## 三、今日预警（{n_alerts} 条）

{alerts}

## 四、AI 建议

{suggestions}

---
*本日报由 MES-AI 自动生成。配置 AI Key 后可切换大模型润色版。*
"""


def render(data):
    s = data["summary"]
    rows = "\n".join(
        "| %s | %s | %d | %d | %d | %d | %s%% | %s |" % (
            l["line"], l["product"], l["plan"], l["actual"],
            l["good"], l["bad"], l["fpy"], l["top_defect"])
        for l in data["lines"]
    )
    alerts = "\n".join(f"{i+1}. 【{t}】{c}" for i, (t, c) in enumerate(data["alerts"])) \
        or "无预警，今日生产平稳。"
    suggestions = []
    if any(t == "质量" for t, _ in data["alerts"]):
        suggestions.append("对直通率低于红线的产线，建议质检员复核该时段检验记录并追溯物料批次。")
    if any(t == "设备" for t, _ in data["alerts"]):
        suggestions.append("维修中设备影响产能，建议将 SMT-2线 部分工单临时转至 SMT-1线。")
    if any(t == "交付" for t, _ in data["alerts"]):
        suggestions.append("完成率偏低的产线建议加班或调整明日排产优先级。")
    if not suggestions:
        suggestions.append("今日各项指标正常，按计划推进即可。")
    md = REPORT_TEMPLATE.format(
        date=data["date"], total_plan=s["total_plan"], total_actual=s["total_actual"],
        completion=s["completion"], total_bad=s["total_bad"], avg_fpy=s["avg_fpy"],
        n_lines=len(data["lines"]),
        n_workshops=len({l["workshop"] for l in data["lines"]}),
        rows=rows, n_alerts=len(data["alerts"]), alerts=alerts,
        suggestions="\n".join(f"- {x}" for x in suggestions),
    )
    llm = LLMClient()
    if llm.enabled:
        polished = llm.chat(
            "你是制造企业的生产管理顾问。用中文把下面的生产日报改写得更专业、更有洞察力，"
            "保留所有数字，分四个部分：总览、产线表现、预警、建议。",
            md)
        if polished:
            return {"markdown": polished, "mode": "llm:" + llm.model, "data": data}
    return {"markdown": md, "mode": "mock:template", "data": data}


if __name__ == "__main__":
    r = render(gen_demo_day())
    print("mode:", r["mode"])
    print(r["markdown"][:1500])
