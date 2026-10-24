"""Shared views are isolated from architecture data and obey layer permissions."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def test_team_views_permissions_and_crud():
    name="Weekly review-"+uuid4().hex[:10]
    data={"layer":"systems","name":name,"query":"Bitrix","kind":"system","verification":"all"}
    with TestClient(app) as c:
        assert c.post("/api/views",headers=VIEWER,json=data).status_code==403
        response=c.post("/api/views",headers=ADMIN,json=data)
        assert response.status_code==201,response.text
        uid=response.json()["id"]
        assert c.post("/api/views",headers=ADMIN,json=data).status_code==409
        listed=c.get("/api/views",headers=VIEWER)
        assert listed.status_code==200,listed.text
        assert any(x["id"]==uid for x in listed.json())
        changed={**data,"query":"DB","verification":"verified"}
        r=c.put("/api/views/"+uid,headers=ADMIN,json=changed)
        assert r.status_code==200,r.text
        assert r.json()["query"]=="DB"
        assert c.delete("/api/views/"+uid,headers=VIEWER).status_code==403
        assert c.delete("/api/views/"+uid,headers=ADMIN).status_code==204
        assert not any(x["id"]==uid for x in c.get("/api/views",headers=ADMIN).json())

def test_team_view_invalid_layer():
    with TestClient(app) as c:
        assert c.post("/api/views",headers=ADMIN,json={"layer":"admin","name":"not allowed"}).status_code==422

def test_viewer_cannot_discover_hidden_infrastructure_views():
    with TestClient(app) as c:
        value={"layer":"infrastructure","name":"Hidden-"+uuid4().hex[:8],"query":"sensitive-internal"}
        result=c.post("/api/views",headers=ADMIN,json=value)
        assert result.status_code==201,result.text
        uid=result.json()["id"]
        visible=c.get("/api/views",headers=VIEWER)
        assert visible.status_code==200
        assert not any(x["id"]==uid for x in visible.json())
        assert c.delete("/api/views/"+uid,headers=ADMIN).status_code==204
