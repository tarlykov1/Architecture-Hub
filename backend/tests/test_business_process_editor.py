"""ED-02 regression: business processes have one canonical domain identity."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}


def test_business_process_create_link_edit_reload_without_legacy_object_duplication():
    with TestClient(app) as client:
        suffix=str(uuid4())
        system=client.post("/api/objects",headers=ADMIN,json={
            "kind":"system","name":"QA-WORK-ED02-system-"+suffix
        })
        assert system.status_code==201,system.text
        category=client.post("/api/business/categories",headers=ADMIN,json={
            "name":"QA-WORK-ED02-category-"+suffix
        })
        assert category.status_code==201,category.text
        payload={"category_id":category.json()["id"],"name":"QA-WORK-ED02-process-"+suffix,"description":"Initial"}
        created=client.post("/api/business/processes",headers=ADMIN,json=payload)
        assert created.status_code==201,created.text
        pid=created.json()["id"]
        assert any(p["id"]==pid for p in client.get("/api/business/processes",headers=ADMIN).json())
        link=client.post("/api/business/system-links",headers=ADMIN,json={
            "process_id":pid,"system_id":system.json()["id"],"role":"supporting"
        })
        assert link.status_code==201,link.text
        non_system=client.post("/api/objects",headers=ADMIN,json={
            "kind":"process","name":"QA-WORK-ED02-legacy-"+suffix
        })
        assert non_system.status_code==201,non_system.text
        invalid_link=client.post("/api/business/system-links",headers=ADMIN,json={
            "process_id":pid,"system_id":non_system.json()["id"],"role":"supporting"
        })
        assert invalid_link.status_code==422
        updated=client.put("/api/business/processes/"+pid,headers=ADMIN,json={
            **payload,"name":"QA-WORK-ED02-edited-"+suffix,"description":"Changed"
        })
        assert updated.status_code==200,updated.text
        assert updated.json()["id"]==pid
        assert updated.json()["description"]=="Changed"
        assert any(p["id"]==pid and p["name"]=="QA-WORK-ED02-edited-"+suffix
                   for p in client.get("/api/business/processes",headers=ADMIN).json())
        assert any(item["id"]==link.json()["id"] and item["process_id"]==pid
                   for item in client.get("/api/business/system-links",headers=ADMIN).json())
        assert not any(o["name"].startswith("QA-WORK-ED02-process-"+suffix)
                       or o["name"].startswith("QA-WORK-ED02-edited-"+suffix)
                       for o in client.get("/api/objects",headers=ADMIN).json())
        bad_category=client.put("/api/business/processes/"+pid,headers=ADMIN,json={
            **payload,"category_id":str(uuid4())
        })
        assert bad_category.status_code==422
        assert client.get("/api/business/processes",headers=ADMIN).status_code==200
