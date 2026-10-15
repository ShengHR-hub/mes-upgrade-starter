#!/usr/bin/env python3
"""
从需求背景文档(docx) + 6份企业数据(xlsx) 构建 RAG 知识库 knowledge.json。
切块策略：docx 按标题分节；xlsx 按表转成自然语言描述行，每10行一块。
用法: python3 build_kb.py
"""
import json
import os
import re

import docx
import openpyxl

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, '..', 'data')
DOCX = os.path.join(BASE, '..', 'docs', '精创电子科技有限公司MES系统建设需求背景.docx')
OUT = os.path.join(BASE, 'knowledge.json')


def chunk_text(text, max_len=700):
    """按句切分，尽量凑满 max_len"""
    sents = re.split(r'(?<=[。！？；])', text)
    chunks, cur = [], ''
    for s in sents:
        if len(cur) + len(s) <= max_len:
            cur += s
        else:
            if cur.strip():
                chunks.append(cur.strip())
            cur = s
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


def from_docx():
    docs = []
    d = docx.Document(DOCX)
    section_title, buf = '文档开头', []
    for p in d.paragraphs:
        t = p.text.strip()
        if not t or t.startswith('目 录'):
            continue
        style = p.style.name if p.style else ''
        if style.startswith('Heading'):
            if buf:
                body = '\n'.join(buf)
                for c in chunk_text(body):
                    docs.append({'source': f'需求背景文档·{section_title}', 'text': c})
                buf = []
            section_title = t
        elif '企业自述' in t or '写在最后' in t:
            for c in chunk_text(t):
                docs.append({'source': f'需求背景文档·{section_title}·企业自述', 'text': c})
        else:
            # 表格转文本 docx 会丢表结构，这里只收段落；表格信息由 xlsx 覆盖
            if len(t) > 8:
                buf.append(t)
    if buf:
        for c in chunk_text('\n'.join(buf)):
            docs.append({'source': f'需求背景文档·{section_title}', 'text': c})
    return docs


def sheet_to_lines(path, sheet, desc):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(c) for c in rows[1]]
    lines = []
    for r in rows[2:]:
        if not any(c not in (None, '') for c in r):
            continue
        parts = [f'{h}：{c}' for h, c in zip(header, r) if c not in (None, '', '—')]
        lines.append('；'.join(parts))
    return desc, lines


def from_xlsx():
    specs = [
        ('01_产品清单.xlsx', '产品清单', '产品主数据：共15个产品型号'),
        ('02_设备清单.xlsx', '设备清单', '设备主数据：共13台设备'),
        ('06_物料清单.xlsx', '物料清单', '物料主数据：共24种物料'),
        ('05_人员账号.xlsx', '人员账号', '人员账号：共23个账号，分admin/manager/operator三级角色'),
    ]
    docs = []
    for fn, sheet, desc in specs:
        _, lines = sheet_to_lines(os.path.join(DATA, fn), sheet, desc)
        for i in range(0, len(lines), 8):
            block = '\n'.join(lines[i:i + 8])
            docs.append({'source': f'企业数据·{sheet}', 'text': f'{desc}。\n{block}'})
    # BOM：两个 sheet
    wb = openpyxl.load_workbook(os.path.join(DATA, '03_BOM清单.xlsx'),
                                read_only=True, data_only=True)
    for ws in wb.worksheets:
        pcode = ws.title.split(' ')[0]
        lines = []
        for r in ws.iter_rows(min_row=3, values_only=True):
            if r[1] and str(r[0]) != '0':
                lines.append(f"物料{r[1]}（{r[2]}，{r[3]}），单台用量{r[4]}{r[5]}")
        docs.append({'source': f'企业数据·BOM清单·{pcode}',
                     'text': f'{pcode} 的BOM共{len(lines)}种物料：\n' + '\n'.join(lines)})
    # 工艺路线：总览 + 工序详情
    wb = openpyxl.load_workbook(os.path.join(DATA, '04_工艺路线.xlsx'),
                                read_only=True, data_only=True)
    ws = wb['工艺路线总览']
    lines = []
    for r in ws.iter_rows(min_row=3, values_only=True):
        if r[0]:
            lines.append(f"{r[0]}（{r[1]}）：{r[2]}道工序，{r[3]}，跨{r[4]}个车间")
    docs.append({'source': '企业数据·工艺路线总览',
                 'text': '15个产品的工艺路线总览：\n' + '\n'.join(lines)})
    ws = wb['JC-PLC-2001工序详情']
    steps = []
    for r in ws.iter_rows(min_row=3, values_only=True):
        if r[0]:
            steps.append(
                f"第{r[0]}道 {r[1]}：{r[2]}/{r[3]}，标准工时{r[4]}，"
                f"关键设备{r[5]}，质控点{r[6]}")
    docs.append({'source': '企业数据·JC-PLC-2001工序详情',
                 'text': 'JC-PLC-2001（PLC控制板卡-标准型）10道工序详情：\n'
                         + '\n'.join(steps)})
    return docs


OVERVIEW = [
    {'source': '需求背景文档·七大痛点总览',
     'text': '精创电子MES建设的七大核心痛点：痛点1生产进度不透明（查单耗时30分钟以上）；'
             '痛点2工单分解依赖人工（每天200个工序任务手工拆）；痛点3质量追溯困难（追溯需1-2天）；'
             '痛点4报工数据滞后且易错（滞后24小时，录入错误率约5%）；痛点5物料批次追溯缺失；'
             '痛点6设备状态不可见（停机30分钟才发现）；痛点7数据统计耗时长（月报需2-3天）。'
             '企业自述：核心就一个字“慢”——信息慢、追溯慢、统计慢、响应慢。详见需求背景文档第四章。'},
    {'source': '需求背景文档·九大功能需求总览',
     'text': 'MES系统九大功能模块：1生产订单管理 2工单管理（自动分解工序） 3工序报工 '
             '4质量检验 5物料管理（批次管控） 6SN追溯 7设备管理（OEE） 8数据看板 9用户权限'
             '（admin/manager/operator三级角色）。技术要求：B/S架构，前后端分离，'
             '后端Java/Spring Boot，前端Vue3，MySQL数据库，Docker容器化部署，JWT认证。'
             '详见需求背景文档第五章。'},
]


def main():
    docs = from_docx() + from_xlsx() + OVERVIEW
    # 去重 + 过短过滤
    seen, uniq = set(), []
    for d in docs:
        key = d['text'][:60]
        if key not in seen and len(d['text']) >= 30:
            seen.add(key)
            uniq.append(d)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(uniq, f, ensure_ascii=False, indent=1)
    print(f'OK -> {OUT}，共 {len(uniq)} 个知识块')
    from collections import Counter
    print(Counter(d['source'].split('·')[0] for d in uniq))


if __name__ == '__main__':
    main()
