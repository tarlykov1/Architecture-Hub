from fastapi.testclient import TestClient
from app.main import app


def test_open_access_can_save_and_reload_then_auth_can_be_restored(monkeypatch):
    monkeypatch.setitem(app.state._state, "arch_hub_open_access", True)
    with TestClient(app) as client:
        mode = client.get("/api/auth/mode")
        assert mode.json() == {"open_access": True}
        assert mode.headers["cache-control"] == "no-store"
        profile = client.get("/api/auth/me").json()
        assert profile["auth_kind"] == "open_access"
        assert profile["permissions"]["systems"] == "write"
        created = client.post("/api/objects", json={"name": "QA-WORK-open-access", "kind": "system"})
        assert created.status_code in (200, 201), created.text
        item_id = created.json()["id"]
        assert any(item["id"] == item_id for item in client.get("/api/objects").json())
        assert client.delete(f"/api/objects/{item_id}").status_code in (200, 204)
        assert client.get("/api/auth/users").status_code == 403
        monkeypatch.setitem(app.state._state, "arch_hub_open_access", False)
        assert client.get("/api/auth/mode").json() == {"open_access": False}
        assert client.get("/api/objects").status_code == 401


def test_mode_cannot_be_enabled_by_client(monkeypatch):
    monkeypatch.setitem(app.state._state, "arch_hub_open_access", False)
    with TestClient(app) as client:
        assert client.post("/api/auth/mode", json={"open_access": True}).status_code == 401
        assert client.get("/api/objects", headers={"X-Open-Access": "true"}).status_code == 401
