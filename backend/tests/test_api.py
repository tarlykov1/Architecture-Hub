"""API smoke and permission tests against a temporary SQLite database."""
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def test_health():
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200

def test_authentication_required():
    with TestClient(app) as client:
        response=client.get("/api/objects")
        assert response.status_code == 401

def test_viewer_can_read_but_not_write():
    with TestClient(app) as client:
        assert client.get("/api/objects",headers=VIEWER).status_code == 200
        assert client.post("/api/objects",json={"kind":"system","name":"CI test system","description":"","status":"active","attributes":{}},headers=VIEWER).status_code == 403
        assert client.get("/api/infra",headers=VIEWER).status_code == 403

def test_admin_can_create_and_read_object():
    with TestClient(app) as client:
        name="CI test system"
        response=client.post("/api/objects",json={"kind":"system","name":name,"description":"Automated smoke test","status":"active","attributes":{}},headers=ADMIN)
        assert response.status_code == 201, response.text
        objects=client.get("/api/objects",headers=ADMIN)
        assert objects.status_code == 200
        assert any(item["id"] == response.json()["id"] for item in objects.json())

def test_demo_disabled_under_access_control():
    with TestClient(app) as client:
        assert client.post("/api/demo/business",headers=ADMIN).status_code == 403

def test_wiki_status_without_secrets():
    with TestClient(app) as client:
        response=client.get("/api/knowledge/status",headers=ADMIN)
        assert response.status_code == 200
        assert "configured" in response.json()
        assert "WIKI_API_TOKEN" not in response.text


def test_architecture_layer_regions_persist_and_obey_permissions():
    with TestClient(app) as client:
        system = client.post("/api/objects", headers=ADMIN, json={
            "kind": "system", "name": "Layer-owned system", "description": "",
            "status": "active", "attributes": {}
        })
        assert system.status_code == 201, system.text
        category = client.post("/api/business/categories", headers=ADMIN, json={"name": "Layer test " + system.json()["id"]})
        assert category.status_code == 201, category.text
        key = "business:" + category.json()["id"]
        payload = {"x": 120.0, "y": 210.0, "width": 650.0, "height": 420.0,
                   "color": "#aa55dd", "members": [system.json()["id"]]}
        forbidden = client.put("/api/diagrams/layer-regions/" + key, headers=VIEWER, json=payload)
        assert forbidden.status_code == 403
        saved = client.put("/api/diagrams/layer-regions/" + key, headers=ADMIN, json=payload)
        assert saved.status_code == 200, saved.text
        assert saved.json()["width"] == 650
        assert saved.json()["members"] == payload["members"]
        regions = client.get("/api/diagrams/layer-regions", headers=VIEWER)
        assert regions.status_code == 200, regions.text
        assert any(item["group_key"] == key and item["color"] == "#aa55dd" for item in regions.json())
        invalid_size = client.put("/api/diagrams/layer-regions/" + key, headers=ADMIN, json={**payload,"width": 15})
        assert invalid_size.status_code == 422
        unknown = client.put("/api/diagrams/layer-regions/business:99999999-9999-4999-8999-999999999999", headers=ADMIN, json=payload)
        assert unknown.status_code == 404
