"""Regression tests: KIS importer, knowledge links and Wiki.js GraphQL adapter."""
from base64 import b64encode
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED
from unittest.mock import patch
import json

from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def _xlsx(system_name):
    ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    def sheet(rows):
        content="".join('<row r="%s">%s</row>'%(i,"".join('<c r="%s%s" t="inlineStr"><is><t>%s</t></is></c>'%(k,i,v) for k,v in cols.items())) for i,cols in rows)
        return '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>'%(ns,content)
    workbook='<workbook xmlns="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ИС" sheetId="1" r:id="rId1"/><sheet name="ВМ" sheetId="2" r:id="rId2"/><sheet name="СУБД" sheetId="3" r:id="rId3"/></sheets></workbook>'%ns
    rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join('<Relationship Id="rId%s" Target="worksheets/sheet%s.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>'%(i,i) for i in range(1,4))+'</Relationships>'
    output=BytesIO()
    with ZipFile(output,"w",ZIP_DEFLATED) as z:
        z.writestr("xl/workbook.xml",workbook)
        z.writestr("xl/_rels/workbook.xml.rels",rels)
        z.writestr("xl/worksheets/sheet1.xml",sheet([(7,{"C":"Название ИС","D":system_name})]))
        # Blank DNS must not crash import.
        z.writestr("xl/worksheets/sheet2.xml",sheet([(6,{"C":"PROD","D":"Application VM"}),(7,{"C":"TEST","D":"Second VM","E":"vm-test.local"})]))
        z.writestr("xl/worksheets/sheet3.xml",sheet([(7,{"C":"PostgreSQL","D":"PROD","E":"database-1"})]))
    return b64encode(output.getvalue()).decode()

def test_kis_preview_import_idempotent_with_blank_dns():
    name="CI-KIS-"+uuid4().hex[:10]
    payload={"filename":"test.xlsx","content_base64":_xlsx(name)}
    with TestClient(app) as client:
        assert client.post("/api/kis/preview",json=payload,headers=VIEWER).status_code==403
        preview=client.post("/api/kis/preview",json=payload,headers=ADMIN)
        assert preview.status_code==200,preview.text
        assert preview.json()["preview"]["system_name"]==name
        created=client.post("/api/kis/import",json=payload,headers=ADMIN)
        assert created.status_code==200,created.text
        assert created.json()["created_systems"]==1
        assert created.json()["created_vms"]==2
        assert created.json()["created_databases"]==1
        again=client.post("/api/kis/import",json=payload,headers=ADMIN)
        assert again.status_code==200
        assert again.json()["created_systems"]==0
        assert again.json()["created_vms"]==0

def test_knowledge_link_lifecycle():
    with TestClient(app) as client:
        system=client.post("/api/objects",headers=ADMIN,json={"name":"KB-"+uuid4().hex[:8],"kind":"system"}).json()
        params={"entity_type":"system","entity_id":system["id"]}
        assert client.get("/api/knowledge/links",params=params,headers=VIEWER).status_code==403
        payload={**params,"wiki_page_id":42,"wiki_path":"ru/ИС/test","title":"Инструкция"}
        link=client.post("/api/knowledge/links",json=payload,headers=ADMIN)
        assert link.status_code==201,link.text
        assert client.post("/api/knowledge/links",json=payload,headers=ADMIN).status_code==409
        links=client.get("/api/knowledge/links",params=params,headers=ADMIN)
        assert len(links.json())==1
        assert links.json()[0]["title"]=="Инструкция"
        assert client.delete("/api/knowledge/links/"+link.json()["id"],headers=ADMIN).status_code==204
        assert client.get("/api/knowledge/links",params=params,headers=ADMIN).json()==[]

class _FakeResponse:
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self,*args):
        return json.dumps({"data":{"pages":{"list":[{"id":7,"title":"Битрикс24","path":"ИС/Битрикс24","locale":"ru","description":""}]}}}).encode()

def test_wiki_search_uses_mock_not_real_service(monkeypatch):
    monkeypatch.setenv("WIKI_API_TOKEN","ci-placeholder-token-not-secret")
    with patch("app.knowledge.urllib.request.urlopen",return_value=_FakeResponse()) as urlopen:
        with TestClient(app) as client:
            response=client.get("/api/knowledge/pages?query=битрикс",headers=ADMIN)
            assert response.status_code==200,response.text
            assert len(response.json())==1
            assert response.json()[0]["title"]=="Битрикс24"
            assert urlopen.call_count==1
