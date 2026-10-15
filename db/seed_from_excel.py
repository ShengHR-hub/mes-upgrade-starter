#!/usr/bin/env python3
"""
把精创电子 6 份企业数据 Excel 转成 seed.sql（INSERT 语句）。
用法: python3 seed_from_excel.py  (在 db/ 目录下运行，读取 ../data/*.xlsx)
"""
import openpyxl
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seed.sql')


def sq(v):
    """SQL 字符串转义"""
    if v is None or v == '' or v == '—':
        return 'NULL'
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v).is_integer() else str(v)
    return "'" + str(v).replace('\\', '\\\\').replace("'", "\\'") + "'"


def rows_of(path, sheet):
    """跳过第1行标题、第2行表头，返回第3行起的非空数据行"""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    out = []
    for r in ws.iter_rows(min_row=3, values_only=True):
        if any(c not in (None, '') for c in r):
            out.append([c for c in r])
    return out


def main():
    sql = ['USE smart_mes;', 'SET FOREIGN_KEY_CHECKS=0;']

    # ---- product ----
    vals = []
    for r in rows_of(f'{DATA_DIR}/01_产品清单.xlsx', '产品清单'):
        # 产品编号 | 产品名称 | 产品线 | 工艺路线 | 月产量 | 单位 | 标准工时 | 备注
        vals.append(f"({sq(r[0])},{sq(r[1])},{sq(r[2])},{sq(r[4])},{sq(r[5])},{sq(r[6])},{sq(r[7])})")
    sql.append('TRUNCATE TABLE product;')
    sql.append('INSERT INTO product (code,name,line,monthly_output,unit,std_hours,remark) VALUES\n'
               + ',\n'.join(vals) + ';')

    # ---- device ----
    vals = []
    for r in rows_of(f'{DATA_DIR}/02_设备清单.xlsx', '设备清单'):
        # 设备编号 | 设备名称 | 所在车间 | 所在产线 | 设备状态 | 购买年份 | 供应商 | 备注
        vals.append(f"({sq(r[0])},{sq(r[1])},{sq(r[2])},{sq(r[3])},{sq(r[4])},{sq(r[5])},{sq(r[6])},{sq(r[7])})")
    sql.append('TRUNCATE TABLE device;')
    sql.append('INSERT INTO device (code,name,workshop,prod_line,status,purchase_year,supplier,remark) VALUES\n'
               + ',\n'.join(vals) + ';')

    # ---- material ----
    vals = []
    for r in rows_of(f'{DATA_DIR}/06_物料清单.xlsx', '物料清单'):
        # 物料编号 | 物料名称 | 规格型号 | 物料类别 | 单位 | 安全库存 | 供应商 | 备注
        vals.append(f"({sq(r[0])},{sq(r[1])},{sq(r[2])},{sq(r[3])},{sq(r[4])},{sq(r[5])},{sq(r[6])},{sq(r[7])})")
    sql.append('TRUNCATE TABLE material;')
    sql.append('INSERT INTO material (code,name,spec,category,unit,safety_stock,supplier,remark) VALUES\n'
               + ',\n'.join(vals) + ';')

    # ---- bom（多 sheet）----
    vals = []
    wb = openpyxl.load_workbook(f'{DATA_DIR}/03_BOM清单.xlsx', read_only=True, data_only=True)
    for ws in wb.worksheets:
        product_code = ws.title.split(' ')[0]  # "JC-PLC-2001 BOM" -> JC-PLC-2001
        for r in ws.iter_rows(min_row=3, values_only=True):
            if any(c not in (None, '') for c in r) and r[1]:
                # 层级 | 物料编号 | 物料名称 | 规格型号 | 单位用量 | 单位 | 供应商 | 备注
                # r[0] 为成品行（层级0）时跳过，只保留物料行
                if str(r[0]) == '0':
                    continue
                vals.append(f"({sq(product_code)},{sq(r[0])},{sq(r[1])},{sq(r[4])},{sq(r[5])})")
    sql.append('TRUNCATE TABLE bom;')
    sql.append('INSERT INTO bom (product_code,level,material_code,qty,unit) VALUES\n'
               + ',\n'.join(vals) + ';')

    # ---- process_route（总览 sheet 只做校验，工序详情 sheet 入库）----
    vals = []
    for r in rows_of(f'{DATA_DIR}/04_工艺路线.xlsx', 'JC-PLC-2001工序详情'):
        # 序号 | 工序名称 | 所在车间 | 所在产线 | 标准工时 | 关键设备 | 质量管控点 | 备注
        std = str(r[4]).replace('分钟/板', '').replace('小时/批', '').strip() if r[4] else None
        vals.append(f"({sq('JC-PLC-2001')},{sq(r[0])},{sq(r[1])},{sq(r[2])},{sq(r[3])},{sq(std)},{sq(r[5])},{sq(r[6])})")
    sql.append('TRUNCATE TABLE process_route;')
    sql.append('INSERT INTO process_route (product_code,seq,step_name,workshop,prod_line,std_minutes,key_device,qc_point) VALUES\n'
               + ',\n'.join(vals) + ';')

    # ---- sys_user（password_hash 一律写占位哈希，首登强制修改；不落盘任何初始口令明文）----
    vals = []
    for r in rows_of(f'{DATA_DIR}/05_人员账号.xlsx', '人员账号'):
        # 用户名 | 姓名 | 所属部门 | 岗位 | 系统角色 | 手机号 | 初始密码 | 备注
        vals.append(f"({sq(r[0])},{sq(r[1])},{sq(r[2])},{sq(r[3])},{sq(r[4])},{sq(r[5])},"
                   f"'$2b$10$PLACEHOLDER_HASH_CHANGE_ON_FIRST_LOGIN')")
    sql.append('TRUNCATE TABLE sys_user;')
    sql.append('INSERT INTO sys_user (username,name,dept,post,role,phone,password_hash) VALUES\n'
               + ',\n'.join(vals) + ';')

    sql.append('SET FOREIGN_KEY_CHECKS=1;')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql) + '\n')
    print(f'OK -> {OUT} ({sum(1 for s in sql if s.startswith("INSERT"))} 条 INSERT)')


if __name__ == '__main__':
    main()
