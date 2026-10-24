"""Incidents: multi-entity links and authorization boundaries."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def test_incident_creation_links_edit_and_impact():
    with TestClient(app) as client:
        a=client.post("/api/objects",headers=ADMIN,json={"name":"Affected-"+uuid4().hex[:8],"kind":"system"})
        b=client.post("/api/objects",headers=ADMIN,json={"name":"Dependent-"+uuid4().hex[:8],"kind":"system"})
        assert a.status_code==201 and b.status_code==201
        aid=a.json()["id"];bid=b.json()["id"]
        rel=client.post("/api/relations",headers=ADMIN,json={"source_id":aid,"target_id":bid,"kind":"depends_on"})
        assert rel.status_code==201,rel.text
        incident={"title":"CI network failure","description":"Regression scenario","status":"open",
                  "severity":"high","links":[{"entity_type":"system","entity_id":aid}]}
        assert client.post("/api/incidents",headers=VIEWER,json=incident).status_code==403
        result=client.post("/api/incidents",headers=ADMIN,json=incident)
        assert result.status_code==201,result.text
        iid=result.json()["id"]
        assert result.json()["links"][0]["entity_id"]==aid
        summary=client.get("/api/incidents/"+iid+"/impact",headers=ADMIN)
        assert summary.status_code==200,summary.text
        assert any(x["entity_id"]==bid for x in summary.json()["potentially_affected"])
        changed={**incident,"severity":"critical","status":"investigating","links":[
            {"entity_type":"system","entity_id":aid},{"entity_type":"system","entity_id":bid}]}
        update=client.put("/api/incidents/"+iid,headers=ADMIN,json=changed)
        assert update.status_code==200,update.text
        assert len(update.json()["links"])==2
        assert update.json()["severity"]=="critical"
        assert client.get("/api/incidents",headers=VIEWER).status_code==200

def test_incident_rejects_missing_entities():
    with TestClient(app) as client:
        payload={"title":"Invalid incident","links":[{"entity_type":"system","entity_id":str(uuid4())}]}
        assert client.post("/api/incidents",headers=ADMIN,json=payload).status_code==422
