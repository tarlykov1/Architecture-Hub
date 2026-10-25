"""KIS reverse-export round trip through the same parser used by the importer."""
from base64 import b64decode
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from app.kis_import import _parse

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def test_export_kis_is_valid_for_import_preview():
    name="KIS round-trip "+uuid4().hex[:10]
    with TestClient(app) as client:
        obj=client.post("/api/objects",headers=ADMIN,json={"name":name,"kind":"system","description":"Business-critical system"})
        assert obj.status_code==201,obj.text
        sid=obj.json()["id"]
        vm=client.post("/api/infra",headers=ADMIN,json={"system_id":sid,"name":"vm-ci-01","kind":"vm","description":"Application host","details":{"environment":"PROD","ip_address":"192.0.2.12","os":"Linux"}})
        assert vm.status_code==201,vm.text
        db=client.post("/api/infra",headers=ADMIN,json={"system_id":sid,"name":"ci-database","kind":"database","description":"Business records","details":{"environment":"PROD","dbms":"PostgreSQL","size_gb":"10"}})
        assert db.status_code==201,db.text
        response=client.get("/api/kis/export/"+sid,headers=ADMIN)
        assert response.status_code==200,response.text
        data=response.json()
        assert data["filename"].endswith(".xlsx")
        assert data["vms"]==1 and data["databases"]==1
        workbook=b64decode(data["content_base64"])
        parsed=_parse(workbook)
        assert parsed["system_name"]==name
        assert len(parsed["vms"])==1 and len(parsed["databases"])==1
        assert parsed["vms"][0]["E"]=="vm-ci-01"
        assert parsed["databases"][0]["E"]=="ci-database"
        preview=client.post("/api/kis/preview",headers=ADMIN,json={"filename":data["filename"],"content_base64":data["content_base64"]})
        assert preview.status_code==200,preview.text
        assert preview.json()["preview"]["system_name"]==name
        assert client.get("/api/kis/export/"+sid,headers=VIEWER).status_code==403

def test_unknown_system_export_404():
    with TestClient(app) as client:
        assert client.get("/api/kis/export/"+str(uuid4()),headers=ADMIN).status_code==404
