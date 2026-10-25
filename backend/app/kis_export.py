"""Export current Architecture Hub system passport as a KIS-compatible XLSX.

New workbook, not a byte-for-byte restoration of an imported Excel template.
No original attachments or unsupported legacy sections are reconstructed.
"""
from __future__ import annotations
from base64 import b64encode
from io import BytesIO
import re
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED
from fastapi import HTTPException,Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from .main import ArchitectureObject,InfrastructureItem,db_session
from .kis_import import router

def _cell(ref:str,value:object)->str:
    value="" if value is None else str(value)
    if not value:return ""
    return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+escape(value.replace("\x00",""))+'</t></is></c>'

def _sheet(rows:dict[int,dict[str,str]])->str:
    body=[]
    for n,cols in sorted(rows.items()):
        cells="".join(_cell(col+str(n),val) for col,val in sorted(cols.items()))
        if cells:body.append(f'<row r="{n}">{cells}</row>')
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join(body)+'</sheetData></worksheet>'

def make_xlsx(sheets:dict[str,dict[int,dict[str,str]]])->bytes:
    names=list(sheets)
    workbook='<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i,name in enumerate(names,1))+'</sheets></workbook>'
    rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,len(names)+1))+'</Relationships>'
    types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,len(names)+1))+'</Types>'
    rootrels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    buffer=BytesIO()
    with ZipFile(buffer,'w',ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',types)
        z.writestr('_rels/.rels',rootrels)
        z.writestr('xl/workbook.xml',workbook)
        z.writestr('xl/_rels/workbook.xml.rels',rels)
        for i,name in enumerate(names,1):z.writestr(f'xl/worksheets/sheet{i}.xml',_sheet(sheets[name]))
    return buffer.getvalue()

def build_card(system:ArchitectureObject,items:list[InfrastructureItem])->bytes:
    attrs=system.attributes or {}
    passport=attrs.get("kis_passport") if isinstance(attrs.get("kis_passport"),dict) else {}
    fields={str(k):str(v) for k,v in passport.items() if v is not None}
    fields["Название ИС"]=system.name
    fields.setdefault("Краткое наименование (используемое)",str(attrs.get("short_name") or ""))
    fields.setdefault("Описание",system.description or "")
    overview={1:{"C":"Карточка информационной системы – экспорт Architecture Hub"},2:{"C":"Сведения сформированы из текущих данных; оригинальное оформление КИС не воспроизводится"}}
    for row,(key,value) in enumerate(fields.items(),4):overview[row]={"C":key,"D":value}
    vm={5:dict(zip(["C","D","E","F","G","H"],["Контур","Назначение","Имя / DNS","IP","ОС","Интернет"]))}
    db={6:dict(zip(["C","D","E","F","G","H"],["СУБД","Контур","Наименование БД","Объём, ГБ","Назначение",""]))}
    vn=6;dn=7
    for item in sorted(items,key=lambda x:(x.kind,x.name)):
        details=item.details or {}
        if item.kind=="vm":
            vm[vn]={"C":str(details.get("environment","")),"D":item.description or "","E":item.name,"F":str(details.get("ip_address","")),"G":str(details.get("os","")),"H":str(details.get("internet_access",""))};vn+=1
        elif item.kind=="database":
            db_name=re.sub(r"^DB:\s*(.*?)\s*\[[^\]]*\]$",r"\1",item.name).strip()
            db[dn]={"C":str(details.get("dbms","")),"D":str(details.get("environment","")),"E":db_name,"F":str(details.get("size_gb","")),"G":item.description or ""};dn+=1
    sheets={"ИС":overview,"ВМ":vm,"СУБД":db,"Зоны ответственности":{6:{"C":"Не экспортируется автоматически – уточните вручную"}},"Сетевая доступность":{6:{"C":"Не экспортируется автоматически – уточните вручную"}},"Документация":{6:{"C":"Документация хранится отдельно в Wiki.js"}}}
    return make_xlsx(sheets)

@router.get("/export/{system_id}")
def export_kis(system_id:UUID,db:Session=Depends(db_session)):
    system=db.get(ArchitectureObject,system_id)
    if not system:raise HTTPException(404,"System not found")
    items=list(db.scalars(select(InfrastructureItem).where(InfrastructureItem.system_id==system_id)).all())
    data=build_card(system,items)
    return {"filename":"KIS_"+str(system.id)[:8]+".xlsx","content_base64":b64encode(data).decode("ascii"),"systems":1,"vms":sum(i.kind=="vm" for i in items),"databases":sum(i.kind=="database" for i in items),"notice":"Новый XLSX по текущим данным – исходный шаблон, сетевые правила и ответственность не восстанавливаются автоматически."}
