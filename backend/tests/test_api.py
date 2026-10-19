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
