
"""KIS XLSX preview and additive import. Uses only Python stdlib for parsing.
Never persists the uploaded XLSX itself. Source text is only stored when user imports."""
from __future__ import annotations

from base64 import b64decode
from hashlib import sha256
from io import BytesIO
import posixpath
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile, BadZipFile

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .main import db_session, ArchitectureObject, InfrastructureItem

router = APIRouter(prefix="/api/kis", tags=["KIS"])

N = {"x":"http://schemas.openxmlformats.org/spreadsheetml/2006/main",
     "r":"http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
CELL = re.compile(r"([A-Z]+)([0-9]+)")
MAX_FILE = 12 * 1024 * 1024
MAX_ROWS = 10000

class Upload(BaseModel):
    filename: str = Field(max_length=255)
    content_base64: str

class ImportRequest(Upload):
    include_vms: bool = True
    include_databases: bool = True

def _sheet_map(data: bytes):
    if len(data) > MAX_FILE:
        raise ValueError("Файл превышает 12 МБ")
    try:
        archive = ZipFile(BytesIO(data))
        names = archive.namelist()
        if not "xl/workbook.xml" in names:
            raise ValueError("Это не XLSX")
        if sum(x.file_size for x in archive.infolist()) > 80*1024*1024:
            raise ValueError("Слишком большой распакованный XLSX")
        strings = []
        if "xl/sharedStrings.xml" in names:
            root=ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings=["".join((t.text or "") for t in si.iter("{%s}t"%N["x"])) for si in root]
        root=ET.fromstring(archive.read("xl/workbook.xml"))
        rels=ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        links={x.get("Id"):x.get("Target") for x in rels}
        out={}
        for sh in root.findall(".//x:sheets/x:sheet",N):
            name=sh.get("name")
            target=links.get(sh.get(RID),"")
            path=posixpath.normpath(posixpath.join("xl",target.lstrip("/"))) if not target.startswith("/xl/") else target.lstrip("/")
            if not path.startswith("xl/worksheets/") or path not in names:
                continue
            content=ET.fromstring(archive.read(path))
            rows={}
            for row in content.findall(".//x:sheetData/x:row",N):
                rn=int(row.get("r","0"))
                if rn > MAX_ROWS: break
                record={}
                for c in row.findall("x:c",N):
                    addr=c.get("r","")
                    match=CELL.fullmatch(addr)
                    if not match:continue
                    val=c.find("x:v",N)
                    inline=c.find("x:is",N)
                    if val is not None and val.text is not None:
                        value=strings[int(val.text)] if c.get("t")=="s" else val.text
                    elif inline is not None:
                        value="".join(t.text or "" for t in inline.iter("{%s}t"%N["x"]))
                    else:continue
                    if value is not None and str(value).strip():
                        record[match.group(1)]=str(value).strip()
                if record:rows[rn]=record
            out[name]=rows
        return out
    except (BadZipFile, ET.ParseError, KeyError, IndexError) as exc:
        raise ValueError("Не удалось прочитать XLSX") from exc

def _parse(data:bytes):
    sheets=_sheet_map(data)
    overview=sheets.get("ИС",{})
    fields={}
    for row in overview.values():
        key=row.get("C","")
        value=row.get("D","")
        if key and value and len(key)<160:
            fields[key]=value
    def records(sheet,start=6,cols=("C","D","E","F","G")):
        return [{k:v for k,v in row.items() if k in cols} for number,row in sheets.get(sheet,{}).items() if number>=start and any(row.get(k) for k in cols)]
    vms=records("ВМ",6,("C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q"))
    databases=records("СУБД",7,("C","D","E","F","G","H"))
    return {"system_name": fields.get("Название ИС") or fields.get("Наименование ИС") or "",
            "short_name": fields.get("Краткое наименование (используемое)",""),
            "fields":fields,"vms":vms,"databases":databases,
            "responsibilities":records("Зоны ответственности",7,("C","D","E","F","G","H","I")),
            "network_rules":records("Сетевая доступность",7,("C","D","E","F","G","H","I","J","K","L","M","N","O","P")),
            "documentation":records("Документация",7,("C","D","E","F","G")),
            "sheet_names":list(sheets)}

def _decode(payload:Upload):
    if not payload.filename.lower().endswith(".xlsx"):
        raise HTTPException(422,"Требуется файл .xlsx")
    try:
        raw=b64decode(payload.content_base64,validate=True)
        return raw,_parse(raw)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422,str(exc)) from exc

@router.post("/preview")
def preview(payload:Upload):
    raw,data=_decode(payload)
    return {"sha256":sha256(raw).hexdigest(),"preview":data,
            "notice":"Только просмотр; информация в базу не записана"}

@router.post("/import")
def import_kis(payload:ImportRequest,db:Session=Depends(db_session)):
    raw,data=_decode(payload)
    name=data["system_name"].strip()
    if not name:
        raise HTTPException(422,"В листе ИС не найдено название в колонке D напротив «Название ИС»")
    fingerprint=sha256(raw).hexdigest()
    existing=db.scalars(select(ArchitectureObject).where(ArchitectureObject.name==name)).first()
    if existing and existing.attributes.get("kis_sha256")==fingerprint:
        return {"created_systems":0,"created_vms":0,"created_databases":0,"message":"Этот файл уже импортирован"}
    if existing:
        # Do not modify manually created system, keep its existing passport.
        system=existing
        created_systems=0
    else:
        system=ArchitectureObject(name=name,kind="system",status="draft",
            description="Импорт из карточки КИС; сведения требуют проверки",
            attributes={"origin":"kis","verification":"draft","kis_sha256":fingerprint,
                        "kis_passport":data["fields"],"kis_filename":payload.filename})
        db.add(system);db.flush();created_systems=1
    # Only create components that do not already exist under this system.
    known={x.name.casefold() for x in db.scalars(select(InfrastructureItem).where(InfrastructureItem.system_id==system.id)).all()}
    counts={"created_vms":0,"created_databases":0}
    if payload.include_vms:
        for idx, row in enumerate(data["vms"]):
            hostname=row.get("E","").splitlines()[0].strip()
            key=hostname or f"KIS-VM-{idx+1}"
            if not row.get("D") and not hostname:continue
            if key.casefold() in known:continue
            db.add(InfrastructureItem(system_id=system.id,kind="vm",name=key,
                description=row.get("D",""),details={"environment":row.get("C",""),
                    "dns":row.get("E",""),"ip_address":row.get("F",""),
                    "os":row.get("G",""),"internet_access":row.get("H",""),
                    "origin":"kis","verification":"draft"}))
            known.add(key.casefold());counts["created_vms"]+=1
    if payload.include_databases:
        for idx,row in enumerate(data["databases"]):
            name_db=row.get("E","").strip() or f"KIS-DB-{idx+1}"
            key=f"DB: {name_db} [{row.get('D','')}]"
            if not row.get("C") and not row.get("E"):continue
            if key.casefold() in known:continue
            db.add(InfrastructureItem(system_id=system.id,kind="database",name=key,
                description=row.get("G",""),details={"environment":row.get("D",""),
                    "dbms":row.get("C",""),"size_gb":row.get("F",""),
                    "origin":"kis","verification":"draft"}))
            known.add(key.casefold());counts["created_databases"]+=1
    db.commit()
    return {"created_systems":created_systems,**counts,
            "message":"Импорт завершён. Сетевые правила, доступы и контакты не импортировались – доступны в предварительном просмотре."}
