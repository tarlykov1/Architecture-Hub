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


def test_guarded_deletion_prunes_only_matching_layout_references():
    with TestClient(app) as client:
        prefix="QA-WORK-DELETE-"+str(uuid4())
        def create(path,payload):
            result=client.post(path,headers=ADMIN,json=payload)
            assert result.status_code==201,result.text
            return result.json()["id"]
        system=create("/api/objects",{"kind":"system","name":prefix})
        first=create("/api/infra",{"system_id":system,"kind":"vm","name":prefix+"-VM1"})
        second=create("/api/infra",{"system_id":system,"kind":"vm","name":prefix+"-VM2"})
        flow=create("/api/flows",{"source_id":first,"target_id":second,"name":prefix+"-flow"})
        vlan=create("/api/networks",{"kind":"vlan","name":prefix+"-VLAN"})
        note={"id":str(uuid4()),"x":11,"y":24,"text":"QA-WORK: retained note"}
        uri="/api/board/layout/"+system
        payload={"positions":{
            first:{"x":5,"y":30},
            second:{"x":280,"y":30},
            "network:"+vlan:{"x":12,"y":14,"width":540,"height":340}
        },"flow_anchors":{flow:{"source_handle":"out-right-1","target_handle":"in-left-1"}},"notes":[note]}
        saved=client.put(uri,headers=ADMIN,json=payload)
        assert saved.status_code==200,saved.text
        # Deletion of a VM with a connected flow is forbidden and non-destructive.
        blocked=client.delete("/api/infra/"+first,headers=ADMIN)
        assert blocked.status_code==409
        assert flow in client.get(uri,headers=ADMIN).json()["flow_anchors"]
        assert client.delete("/api/flows/"+flow,headers=ADMIN).status_code==204
        after_flow=client.get(uri,headers=ADMIN).json()
        assert flow not in after_flow["flow_anchors"]
        assert after_flow["positions"][first]["x"]==5
        assert after_flow["notes"]==[note]
        assert client.delete("/api/infra/"+first,headers=ADMIN).status_code==204
        after_vm=client.get(uri,headers=ADMIN).json()
        assert first not in after_vm["positions"]
        assert second in after_vm["positions"]
        assert client.delete("/api/networks/"+vlan,headers=ADMIN).status_code==204
        after_vlan=client.get(uri,headers=ADMIN).json()
        assert "network:"+vlan not in after_vlan["positions"]
        assert after_vlan["positions"][second]["x"]==280
        assert after_vlan["notes"]==[note]
        # The layout remains saveable after deleted flow IDs and networks disappear.
        again=client.put(uri,headers=ADMIN,json={"positions":after_vlan["positions"],"notes":after_vlan["notes"],"flow_anchors":after_vlan["flow_anchors"]})
        assert again.status_code==200,again.text
