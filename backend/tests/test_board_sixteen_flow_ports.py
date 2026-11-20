"""16 connection positions per VM, including persisted legacy 1/2 indices."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}


def test_sixteen_flow_ports_persist_without_network_changes():
    with TestClient(app) as client:
        def make(url, data):
            response=client.post(url,json=data,headers=ADMIN)
            assert response.status_code==201, response.text
            return response.json()["id"]

        system=make("/api/objects",{"kind":"system","name":"QA-WORK-16-PORTS-"+uuid4().hex[:8]})
        source=make("/api/infra",{"system_id":system,"name":"source","kind":"vm"})
        target=make("/api/infra",{"system_id":system,"name":"target","kind":"vm"})
        flows=[make("/api/flows",{
            "source_id":source,"target_id":target,"name":"test-port-"+str(index)
        }) for index in range(4)]
        ports={
            flows[0]:{"source_handle":"out-top-3","target_handle":"in-bottom-4"},
            flows[1]:{"source_handle":"out-right-4","target_handle":"in-left-3"},
            flows[2]:{"source_handle":"out-bottom-1","target_handle":"in-top-2"},
            flows[3]:{"source_handle":"out-left-2","target_handle":"in-right-1"},
        }
        response=client.put("/api/board/layout/"+system,headers=ADMIN,json={
            "positions":{},"flow_anchors":ports
        })
        assert response.status_code==200,response.text
        assert response.json()["flow_anchors"]==ports
        reread=client.get("/api/board/layout/"+system,headers=ADMIN)
        assert reread.status_code==200
        assert reread.json()["flow_anchors"]==ports
        # Do not change technical flow records when redistributing diagram edges.
        records=client.get("/api/flows",headers=ADMIN).json()
        for fid in flows:
            row=next(item for item in records if item["id"]==fid)
            assert row["source_id"]==source
            assert row["target_id"]==target

        bad=client.put("/api/board/layout/"+system,headers=ADMIN,json={
            "positions":{},"flow_anchors":{flows[0]:{"source_handle":"out-top-5","target_handle":"in-bottom-4"}}
        })
        assert bad.status_code==422,bad.text
        unchanged=client.get("/api/board/layout/"+system,headers=ADMIN).json()
        assert unchanged["flow_anchors"]==ports
