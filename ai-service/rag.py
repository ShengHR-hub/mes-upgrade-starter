#!/usr/bin/env python3
"""RAG 问答引擎（纯标准库，零第三方依赖）。
检索：字符 bigram TF-IDF + 余弦相似度
生成：可插拔 LLM（OpenAI 兼容接口）；未配置 Key 时用抽取式回答（mock 模式照常演示）
环境变量（可选）：AI_BASE_URL / AI_API_KEY / AI_MODEL / AI_TIMEOUT_SECONDS

⚠️ 本文件是 ai-demo/rag.py 的**派生副本**（S3 审查修复，2026-10-10）：
   - LLMClient 新增 chat_full()：返回文本 + 供应商真实 usage；超时可配置（默认 2 秒，P2-7/P2-9）
   - chat() 保留原签名（只返回文本），供 daily_report 等旧调用方使用
   - 抽出 extractive_answer()：本地抽取式回答可被服务层直接调用（回退路径不再改环境变量）
   - ask() 返回值新增 usage 字段
   检索算法（bigram TF-IDF + 余弦）未改动。
"""
import json
import math
import os
import re
import urllib.request
from collections import Counter

BASE = os.path.dirname(os.path.abspath(__file__))


def bigrams(text):
    t = re.sub(r"\s+", "", text)
    return [t[i:i + 2] for i in range(len(t) - 1)]


class Retriever:
    def __init__(self, kb_path=None):
        kb_path = kb_path or os.path.join(BASE, "knowledge.json")
        self.docs = json.load(open(kb_path, encoding="utf-8"))
        df = Counter()
        self.tf_list = []
        for d in self.docs:
            tf = Counter(bigrams(d["source"] + "\n" + d["text"]))
            self.tf_list.append(tf)
            for tok in tf:
                df[tok] += 1
        n = len(self.docs)
        self.idf = {t: math.log((n + 1) / (c + 1)) + 1 for t, c in df.items()}

    def _vec(self, tf):
        return {t: c * self.idf.get(t, 1.0) for t, c in tf.items()}

    @staticmethod
    def _cos(a, b):
        inter = set(a) & set(b)
        num = sum(a[t] * b[t] for t in inter)
        na = math.sqrt(sum(v * v for v in a.values()))
        nb = math.sqrt(sum(v * v for v in b.values()))
        return num / (na * nb) if na and nb else 0.0

    def search(self, query, top_k=3):
        qv = self._vec(Counter(bigrams(query)))
        scored = []
        for d, tf in zip(self.docs, self.tf_list):
            bonus = 0.0
            for kw in re.findall(r"[A-Z]{2,}-[A-Z0-9\-]+", query):
                if kw in d["text"]:
                    bonus += 0.2
            for kw in re.findall(r"[\u4e00-\u9fff]{2,}", query):
                if kw in d["text"]:
                    bonus += 0.06
            for i in range(len(query) - 1):
                bg = query[i:i + 2]
                if "\u4e00" <= bg[0] <= "\u9fff" and bg in d["source"]:
                    bonus += 0.08
            scored.append((self._cos(qv, self._vec(tf)) + bonus, d))
        scored.sort(key=lambda x: -x[0])
        return [
            {"score": round(s, 3), "source": d["source"], "text": d["text"]}
            for s, d in scored[:top_k]
            if s > 0.01
        ]


DEFAULT_LLM_TIMEOUT = 2.0


def llm_timeout():
    """模型调用超时（秒）。环境变量 AI_TIMEOUT_SECONDS 可配置，默认 2 秒（P2-7）。"""
    raw = os.environ.get("AI_TIMEOUT_SECONDS", "")
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_LLM_TIMEOUT
    return v if v > 0 else DEFAULT_LLM_TIMEOUT


class LLMClient:
    def __init__(self):
        self.base = os.environ.get("AI_BASE_URL", "").rstrip("/")
        self.key = os.environ.get("AI_API_KEY", "")
        self.model = os.environ.get("AI_MODEL", "gpt-4o-mini")
        self.timeout = llm_timeout()
        self.enabled = bool(self.base and self.key)

    def chat_full(self, system, user):
        """调用模型，返回 {"content": str, "usage": {"tokensIn": int, "tokensOut": int}}。

        - 未配置 Key 时返回 None（调用方走本地模式）。
        - 超时/网络/响应格式异常一律向上抛，由调用方回退本地（degraded）。
        - usage 如实读取供应商返回的 prompt_tokens / completion_tokens（P2-9）。
        """
        if not self.enabled:
            return None
        body = json.dumps(
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
            }
        ).encode()
        req = urllib.request.Request(
            self.base + "/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.key,
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            payload = json.load(r)
        choices = payload.get("choices") or []
        content = ""
        if choices:
            content = ((choices[0].get("message") or {}).get("content") or "")
        u = payload.get("usage") or {}
        return {
            "content": content,
            "usage": {
                "tokensIn": int(u.get("prompt_tokens") or 0),
                "tokensOut": int(u.get("completion_tokens") or 0),
            },
        }

    def chat(self, system, user):
        """兼容旧签名：只返回文本（daily_report 等调用方使用）。"""
        r = self.chat_full(system, user)
        return r["content"] if r else None


SYSTEM_PROMPT = (
    "你是精创电子科技有限公司 MES 系统的智能助手。"
    "只根据下面提供的企业资料回答问题，不要编造资料中没有的信息；"
    "如果资料不足以回答，请明确说“资料中没有相关信息”。回答简洁，中文。"
)


def ask(question, top_k=3):
    ret = Retriever()
    hits = ret.search(question, top_k=top_k)
    llm = LLMClient()
    if not hits:
        return {"answer": "知识库中没有找到相关信息，换个问法试试。",
                "sources": [], "mode": "none",
                "usage": {"tokensIn": 0, "tokensOut": 0}}
    context = "\n\n".join(
        "【资料%d】%s" % (i + 1, h["text"]) for i, h in enumerate(hits)
    )
    if llm.enabled:
        full = llm.chat_full(SYSTEM_PROMPT, "企业资料：\n" + context + "\n\n问题：" + question)
        answer = full["content"]
        usage = full["usage"]
        mode = "llm:" + llm.model
    else:
        answer = extractive_answer(question, hits)
        usage = {"tokensIn": 0, "tokensOut": 0}
        mode = "mock:extractive"
    return {
        "answer": answer,
        "sources": [{"source": h["source"], "score": h["score"]} for h in hits],
        "mode": mode,
        "usage": usage,
    }


def extractive_answer(question, hits):
    """本地抽取式回答（mock 分支），供未配置 Key 或模型回退时使用。"""
    if not hits:
        return ""
    codes = re.findall(r"[A-Z]{2,}-[A-Z0-9\-]+", question)
    picked = None
    if codes:
        for h in hits:
            for line in h["text"].split("\n"):
                if codes[0] in line:
                    picked = (h["source"], line.strip())
                    break
            if picked:
                break
    if picked:
        return "根据企业资料（%s）：\n%s" % picked
    # 跨 chunk 抽取与问题最相关的句子
    qb = set(bigrams(question))
    cands = []
    for h in hits:
        for s in re.split(r"(?<=[。！？\n])", h["text"]):
            s = s.strip()
            if len(s) < 10:
                continue
            ov = len(qb & set(bigrams(s)))
            if ov:
                cands.append((ov, s, h["source"]))
    cands.sort(key=lambda x: -x[0])
    seen, top = set(), []
    for ov, s, src_name in cands:
        if s[:20] not in seen:
            seen.add(s[:20])
            top.append((s, src_name))
        if len(top) >= 5:
            break
    if top:
        return "根据企业资料综合回答：\n" + "\n".join("· " + s for s, _ in top)
    best = hits[0]["text"]
    sents = re.split(r"(?<=[。！？])", best)
    return "根据企业资料（%s）：\n%s" % (
        hits[0]["source"], "".join(sents[:4]).strip())


if __name__ == "__main__":
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "JC-PLC-2001有哪些工序？"
    r = ask(q)
    print("Q:", q)
    print("mode:", r["mode"])
    print("A:", r["answer"][:600])
    print("sources:", r["sources"])
