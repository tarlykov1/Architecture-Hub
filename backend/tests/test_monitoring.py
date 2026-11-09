"""Monitoring registry: independent CI references, safe external links, auditing and RBAC."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}
SECURITY={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def create_ci(client):
    suffix=str(uuid4())[:8]
    resp=client.post("/api/objects",headers=ADMIN,json={"kind":"system","name":"Monitor target "+suffix})
    assert resp.status_code == 201, resp.text
    sid=resp.json()["id"]
    vm=client.post("/api/infra",headers=ADMIN,json={"kind":"vm","system_id":sid,"name":"Monitor VM "+suffix})
    assert vm.status_code == 201, vm.text
    return sid,vm.json()["id"]


def create_source(client, system_id=None):
    data={"name":"Grafana "+str(uuid4())[:8],"kind":"grafana",
          "base_url":"https://grafana.example.org", "system_id":system_id,
          "description":"Read-only dashboard navigation"}
    res=client.post("/api/monitoring/sources",headers=ADMIN,json=data)
    assert res.status_code == 201,res.text
    return res.json()


def test_monitoring_link_is_optional_and_audited_for_unconnected_vm():
    with TestClient(app) as client:
        sid,vm=create_ci(client)
        before=client.get("/api/monitoring/links",headers=ADMIN,
                          params={"target_type":"component","target_id":vm})
        assert before.status_code == 200 and before.json() == []
        # Monitoring source may be related to an independently registered IS.
        source=create_source(client,sid)
        data={"source_id":source["id"],"target_type":"component","target_id":vm,
              "relation_kind":"monitors",
              "dashboard_url":"https://grafana.example.org/d/vm?var-host=test01",
              "external_ref":"vm-test01","notes":"CPU, RAM"}
        result=client.post("/api/monitoring/links",headers=ADMIN,json=data)
        assert result.status_code == 201,result.text
        link=result.json()
        assert link["external_ref"] == "vm-test01"
        assert link["target_id"] == vm
        stored=client.get("/api/monitoring/links",headers=ADMIN,
                          params={"target_type":"component","target_id":vm})
        assert [r["id"] for r in stored.json()] == [link["id"]]
        assert client.post("/api/monitoring/links",headers=ADMIN,json=data).status_code == 409
        assert client.delete("/api/monitoring/sources/"+source["id"],headers=ADMIN).status_code == 409
        history=client.get("/api/board/audit",headers=ADMIN).json()
        assert any(any(c["action"]=="create_monitoring_link" and c["id"]==link["id"]
                       for c in entry["changes"]) for entry in history)

        changed={**data,"dashboard_url":"https://grafana.example.org/d/vm-new"}
        saved=client.put("/api/monitoring/links/"+link["id"],headers=ADMIN,json=changed)
        assert saved.status_code == 200 and saved.json()["dashboard_url"]==changed["dashboard_url"]
        assert client.delete("/api/monitoring/links/"+link["id"],headers=ADMIN).status_code == 204
        assert client.get("/api/monitoring/links",headers=ADMIN,
                          params={"target_type":"component","target_id":vm}).json() == []
        assert client.delete("/api/monitoring/sources/"+source["id"],headers=ADMIN).status_code == 204


def test_system_target_supported_and_invalid_target_rejected():
    with TestClient(app) as client:
        system_id,_=create_ci(client)
        source=create_source(client)
        data={"source_id":source["id"],"target_type":"system","target_id":system_id,
              "relation_kind":"visualizes","dashboard_url":"","external_ref":""}
        result=client.post("/api/monitoring/links",headers=ADMIN,json=data)
        assert result.status_code == 201,result.text
        assert result.json()["target_type"]=="system"
        assert client.get("/api/monitoring/links",headers=ADMIN,
                          params={"target_type":"system","target_id":system_id}).json()[0]["id"] == result.json()["id"]
        bad={**data,"target_id":str(uuid4())}
        assert client.post("/api/monitoring/links",headers=ADMIN,json=bad).status_code == 422
        assert client.get("/api/monitoring/links",headers=ADMIN,
                          params={"target_id":system_id}).status_code == 422


def test_monitoring_link_url_allowlist_and_no_embedded_credentials():
    with TestClient(app) as client:
        sid,vm=create_ci(client)
        source=create_source(client)
        for url in ["javascript:alert(1)","data:text/html,hello",
                    "https://user:password@grafana.example.org/d/one",
                    "https://grafana.example.org/with space",
                    "file:///etc/passwd"]:
            payload={"source_id":source["id"],"target_type":"component",
                     "target_id":vm,"dashboard_url":url}
            assert client.post("/api/monitoring/links",headers=ADMIN,json=payload).status_code == 422,url
        for url in ["javascript:alert(1)","https://u:p@host.example.org"]:
            payload={"name":"Bad","kind":"grafana","base_url":url}
            assert client.post("/api/monitoring/sources",headers=ADMIN,json=payload).status_code == 422,url


def test_monitoring_respects_existing_infrastructure_permissions():
    with TestClient(app) as client:
        sid,vm=create_ci(client)
        source=create_source(client)
        payload={"source_id":source["id"],"target_type":"component","target_id":vm}
        assert client.get("/api/monitoring/sources",headers=VIEWER).status_code == 403
        assert client.post("/api/monitoring/links",headers=VIEWER,json=payload).status_code == 403
        assert client.get("/api/monitoring/sources").status_code == 401
        assert client.get("/api/monitoring/sources",headers=ADMIN).status_code == 200
