from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.password_auth import PasswordAuthConfig, make_password_hash

KEY = "ci-admin-token-123456789012345678901234"


def test_open_demo_can_use_named_signoff_without_anonymous_approval(monkeypatch):
    password = "testing-only-account-password"
    monkeypatch.setitem(app.state._state, "arch_hub_open_access", True)
    monkeypatch.setitem(app.state._state, "arch_hub_keys", {KEY: "admin"})
    monkeypatch.setitem(app.state._state, "arch_hub_password_auth",
                        PasswordAuthConfig(make_password_hash(password), b"x" * 48))
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        registration = client.post("/api/auth/users", json={
            "username": "qasigner" + suffix, "password": password,
            "role": "engineer", "display_name": "QA reviewer"
        }, headers={"Authorization": "Bearer " + KEY})
        assert registration.status_code == 201, registration.text
        assert client.post("/api/auth/users", json={
            "username": "qafake" + suffix, "password": password,
            "role": "admin"
        }).status_code == 403

        login = client.post("/api/auth/login", json={
            "username": "qasigner" + suffix, "password": password
        })
        assert login.status_code == 200, login.text
        signed = {"Authorization": "Bearer " + login.json()["access_token"]}
        identity = client.get("/api/auth/me", headers=signed).json()
        assert identity["auth_kind"] == "named_user"
        assert identity["role"] == "engineer"
        assert client.get("/api/auth/me").json()["auth_kind"] == "open_access"

        sys = client.post("/api/objects", json={
            "kind": "system", "name": "QA-WORK-Approvals-" + suffix
        }).json()["id"]
        decision = client.post("/api/technical-decisions", json={
            "title": "QA-WORK-Approval", "system_id": sys
        }).json()
        uri = "/api/technical-decisions/" + decision["id"]
        draft = client.put(uri, json={
            "title": "QA-WORK-Approval",
            "expected_revision": decision["revision"],
            "required_services": ["engineer"],
            "proposed_vms": [{
                "id": str(uuid4()), "system_id": sys,
                "kind": "vm", "name": "QA-WORK-Draft-VM",
                "x": 100, "y": 100
            }]
        })
        assert draft.status_code == 200, draft.text
        review = client.post(uri + "/submit", json={
            "expected_revision": draft.json()["revision"]
        }).json()

        unsigned = client.post(uri + "/review", json={
            "expected_revision": review["revision"],
            "verdict": "approved"
        })
        assert unsigned.status_code == 403
        approved = client.post(uri + "/review", headers=signed, json={
            "expected_revision": review["revision"],
            "verdict": "approved", "note": "Infrastructure validated"
        })
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "approved"
        assert approved.json()["approvals"][0]["actor_name"] == "QA reviewer"

        architect = client.post("/api/auth/users", json={
            "username": "qaarchitect" + suffix, "password": password,
            "role": "architect", "display_name": "QA decision author"
        }, headers={"Authorization": "Bearer " + KEY})
        assert architect.status_code == 201, architect.text
        architect_login = client.post("/api/auth/login", json={
            "username": "qaarchitect" + suffix, "password": password
        })
        assert architect_login.status_code == 200
        architect_header = {"Authorization": "Bearer " + architect_login.json()["access_token"]}
        published = client.post(uri + "/publish", headers=architect_header, json={
            "expected_revision": approved.json()["revision"]
        })
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"
        # Publishing a decision does not create the proposed infrastructure.
        assert not any(item["name"] == "QA-WORK-Draft-VM"
                       for item in client.get("/api/infra").json())
