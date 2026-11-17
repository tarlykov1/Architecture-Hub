"""Editing-only diagram notes: typed input, no technical entity mutation."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}

def test_layout_notes_persist_and_preserve_legacy_layout_and_flow_fields():
    with TestClient(app) as client:
        created=client.post("/api/objects",headers=ADMIN,json={
            "kind":"system","name":"QA-WORK-Notes-"+str(uuid4())
        })
        assert created.status_code==201,created.text
        system=created.json()["id"]
        uri="/api/board/layout/"+system
        note={"id":str(uuid4()),"x":135.25,"y":-45.5,"text":"QA-WORK: только визуальная заметка"}
        saved=client.put(uri,headers=ADMIN,json={"positions":{},"notes":[note]})
        assert saved.status_code==200,saved.text
        assert saved.json()["notes"]==[note]
        assert client.get(uri,headers=ADMIN).json()["notes"]==[note]
        # An old client that omits notes does not erase existing annotations.
        older=client.put(uri,headers=ADMIN,json={"positions":{}})
        assert older.status_code==200,older.text
        assert older.json()["notes"]==[note]
        assert client.get("/api/infra",headers=ADMIN).status_code==200
        assert client.get("/api/flows",headers=ADMIN).status_code==200
        duplicate=client.put(uri,headers=ADMIN,json={"positions":{},"notes":[note,note]})
        assert duplicate.status_code==422
        assert client.get(uri,headers=ADMIN).json()["notes"]==[note]
        empty=client.put(uri,headers=ADMIN,json={"positions":{},"notes":[{**note,"text":""}]})
        assert empty.status_code==422
        assert client.get(uri,headers=ADMIN).json()["notes"]==[note]
        removed=client.put(uri,headers=ADMIN,json={"positions":{},"notes":[]})
        assert removed.status_code==200,removed.text
        assert client.get(uri,headers=ADMIN).json()["notes"]==[]
