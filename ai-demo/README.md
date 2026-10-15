# MES-AI 演示系统

基于精创电子真实企业数据（需求背景文档 + 6 份数据文件）的两个 AI 功能演示：
**RAG 工艺知识问答** + **AI 生产日报**。纯 Python 标准库实现，零第三方依赖即可运行。

## 快速运行

```bash
cd ai-demo
python3 app.py 8080
# 打开 http://localhost:8080
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `app.py` | 演示 Web 服务（标准库 http.server），两个接口：`/api/ask` 问答、`/api/report` 日报 |
| `static/index.html` | 单页演示界面（问答 / 日报两个面板，无外部依赖） |
| `rag.py` | RAG 问答引擎：字符 bigram TF-IDF 检索 + 可插拔 LLM |
| `daily_report.py` | AI 日报：演示数据生成 + 模板渲染（可接 LLM 润色） |
| `build_kb.py` | 知识库构建脚本（需 python-docx、openpyxl，仅构建时需要） |
| `knowledge.json` | 已构建好的知识库（31 个知识块） |

## 接入真实大模型（可选）

不配置时为本地 mock 模式，演示照常进行。配置后自动切换为大模型生成：

```bash
export AI_BASE_URL="https://你的中转站/v1"
export AI_API_KEY="你的Key"
export AI_MODEL="gpt-4o-mini"
python3 app.py 8080
```

## 重新构建知识库（可选）

```bash
pip install python-docx openpyxl
python3 build_kb.py
```
