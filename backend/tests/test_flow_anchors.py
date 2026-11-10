"""Eight-point flow anchors are presentation geometry, not technical networking."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app
from .test_board import ADMIN, create_system_and_vm


def test_saved_flow_anchors_survive_reload_and_are_audited():
    with TestClient(app) as client:
        system,source=create_system_and_vm(client)
        _,target=create_system_and_vm(client)
        created=client.post("/api/flows", headers=ADMIN,
                            json={"source_id":source,"target_id":target,"name":"Test port anchor"})
        assert created.status_code==201,created.text
        flow_id=created.json()["id"]
        first={"positions":{source:{"x":80,"y":90},target:{"x":630,"y":90}}}
        assert client.put("/api/board/layout/"+system,headers=ADMIN,json=first).status_code==200
        loaded=client.get("/api/board/layout/"+system,headers=ADMIN).json()
        assert loaded["positions"]==first["positions"]
        assert loaded["flow_anchors"]=={}
        anchors={flow_id:{"source_handle":"out-bottom-2","target_handle":"in-top-1"}}
        saved=client.put("/api/board/layout/"+system,headers=ADMIN,
                         json={**first,"flow_anchors":anchors})
        assert saved.status_code==200,saved.text
        assert saved.json()["flow_anchors"]==anchors
        reloaded=client.get("/api/board/layout/"+system,headers=ADMIN).json()
        assert reloaded["positions"]==first["positions"]
        assert reloaded["flow_anchors"]==anchors
        audit=client.get("/api/board/audit",headers=ADMIN).json()
        assert any(any(c["action"]=="update_flow_anchor" and c["id"]==flow_id
                       and c["after"]==anchors[flow_id] for c in entry["changes"]) for entry in audit)
        # Older clients unaware of anchors must not erase them during a move.
        moved=client.put("/api/board/layout/"+system,headers=ADMIN,
                         json={"positions":{source:{"x":100,"y":130}}})
        assert moved.status_code==200,moved.text
        assert moved.json()["flow_anchors"]==anchors
        # Moving the end to another port changes only presentation, not flow endpoints.
        more={flow_id:{"source_handle":"out-left-2","target_handle":"in-right-2"}}
        assert client.put("/api/board/layout/"+system,headers=ADMIN,
                          json={"positions":{source:{"x":100,"y":130}},"flow_anchors":more}).status_code==200
        flow=next(v for v in client.get("/api/flows",headers=ADMIN).json() if v["id"]==flow_id)
        assert flow["source_id"]==source and flow["target_id"]==target


def test_flow_anchors_reject_unknown_flow_and_bad_points_without_data_loss():
    with TestClient(app) as client:
        system,source=create_system_and_vm(client)
        _,target=create_system_and_vm(client)
        created=client.post("/api/flows",headers=ADMIN,
                            json={"source_id":source,"target_id":target,"name":"Test invalid anchor"})
        assert created.status_code==201,created.text
        flow_id=created.json()["id"]
        correct={"positions":{source:{"x":0,"y":0}},"flow_anchors":{
            flow_id:{"source_handle":"out-right-1","target_handle":"in-left-2"}
        }}
        assert client.put("/api/board/layout/"+system,headers=ADMIN,json=correct).status_code==200
        for invalid in [
            {"flow_anchors":{flow_id:{"source_handle":"out-right-3","target_handle":"in-left-1"}}},
            {"flow_anchors":{flow_id:{"source_handle":"in-left-1","target_handle":"out-right-1"}}},
            {"flow_anchors":{str(uuid4()):{"source_handle":"out-right-1","target_handle":"in-left-1"}}},
            {"flow_anchors":{"not-a-uuid":{"source_handle":"out-right-1","target_handle":"in-left-1"}}},
        ]:
            result=client.put("/api/board/layout/"+system,headers=ADMIN,
                              json={**correct,**invalid})
            assert result.status_code==422,result.text
        loaded=client.get("/api/board/layout/"+system,headers=ADMIN).json()
        assert loaded["flow_anchors"]==correct["flow_anchors"]
        assert loaded["positions"]==correct["positions"]
