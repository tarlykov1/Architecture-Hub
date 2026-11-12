"""Account identity, role permissions and immediate session revocation."""
from __future__ import annotations

from uuid import UUID, uuid4
import pytest

from fastapi.testclient import TestClient
from app.main import app, AuthUser, SessionLocal
from app.password_auth import (
    PasswordAuthConfig, _failures, make_password_hash, issue_user_session,
)

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}
SEED_PASSWORD = "only-ci-shared-password"
USER_PASSWORD = "ci-example-strong-password"


@pytest.fixture
def accounts(monkeypatch):
    config = PasswordAuthConfig(make_password_hash(SEED_PASSWORD),
                                b"user-management-ci-signing-secret-1234567890")
    monkeypatch.setitem(app.state._state, "arch_hub_password_auth", config)
    _failures.clear()
    created = []
    def remember(id):
        created.append(UUID(id))
    yield config, remember
    with SessionLocal() as db:
        for id in created:
            row = db.get(AuthUser, id)
            if row is not None:
                db.delete(row)
        db.commit()
    _failures.clear()


def create_account(client, remember, role="viewer", username=None):
    username = username or "qa" + uuid4().hex[:12]
    response = client.post("/api/auth/users", headers=ADMIN, json={
        "username": username, "display_name": "QA employee",
        "password": USER_PASSWORD, "role": role,
    })
    assert response.status_code == 201, response.text
    item = response.json()
    remember(item["id"])
    assert "password" not in item
    assert "password_hash" not in item
    return item


def login(client, username, password=USER_PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def test_individual_viewer_can_log_in_without_permissions_escalation(accounts):
    _, remember = accounts
    with TestClient(app) as client:
        viewer = create_account(client, remember, role="viewer")
        response = login(client, viewer["username"])
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        assert token.startswith("ah2.")
        bearer = {"Authorization": "Bearer " + token}
        profile = client.get("/api/auth/me", headers=bearer)
        assert profile.status_code == 200
        assert profile.json()["username"] == viewer["username"]
        assert profile.json()["role"] == "viewer"
        assert profile.json()["auth_kind"] == "named_user"
        assert client.get("/api/objects", headers=bearer).status_code == 200
        assert client.get("/api/infra", headers=bearer).status_code == 403
        assert client.get("/api/auth/users", headers=bearer).status_code == 403
        assert client.post("/api/objects", json={"kind": "system", "name": "Forbidden"}, headers=bearer).status_code == 403


def test_admin_can_manage_users_and_role_changes_revoke_sessions(accounts):
    _, remember = accounts
    with TestClient(app) as client:
        user = create_account(client, remember)
        bearer = {"Authorization": "Bearer " + login(client, user["username"]).json()["access_token"]}
        denied = client.patch("/api/auth/users/" + user["id"], headers=bearer, json={"role": "admin"})
        assert denied.status_code == 403
        changed = client.patch("/api/auth/users/" + user["id"], headers=ADMIN,
                               json={"role": "engineer", "display_name": "Infrastructure engineer"})
        assert changed.status_code == 200
        assert changed.json()["role"] == "engineer"
        assert client.get("/api/objects", headers=bearer).status_code == 401
        new_token = login(client, user["username"]).json()["access_token"]
        reauth = {"Authorization": "Bearer " + new_token}
        assert client.get("/api/auth/me", headers=reauth).json()["role"] == "engineer"
        assert client.get("/api/infra", headers=reauth).status_code == 200
        assert client.post("/api/auth/users", headers=reauth, json={}).status_code == 403
        assert client.get("/api/auth/users", headers=VIEWER).status_code == 403


def test_reset_disable_and_login_restrictions(accounts):
    _, remember = accounts
    with TestClient(app) as client:
        user = create_account(client, remember)
        logged = login(client, user["username"])
        old_token = logged.json()["access_token"]
        reset = client.post("/api/auth/users/" + user["id"] + "/reset-password",
                            headers=ADMIN, json={"password": "new-ci-password-strong"})
        assert reset.status_code == 200
        assert client.get("/api/objects", headers={"Authorization": "Bearer " + old_token}).status_code == 401
        assert login(client, user["username"]).status_code == 401
        logged = login(client, user["username"], "new-ci-password-strong")
        assert logged.status_code == 200
        changed = client.patch("/api/auth/users/" + user["id"], headers=ADMIN, json={"enabled": False})
        assert changed.status_code == 200
        assert client.get("/api/objects", headers={"Authorization": "Bearer " + logged.json()["access_token"]}).status_code == 401
        assert login(client, user["username"], "new-ci-password-strong").status_code == 401
        assert client.patch("/api/auth/users/" + user["id"], headers=ADMIN, json={"enabled": True}).status_code == 200


def test_user_changes_own_password_and_old_session_is_revoked(accounts):
    _, remember = accounts
    with TestClient(app) as client:
        user = create_account(client, remember)
        previous = login(client, user["username"]).json()["access_token"]
        bearer = {"Authorization": "Bearer " + previous}
        assert client.post("/api/auth/change-password", headers=bearer,
                           json={"current_password": "incorrect", "new_password": "different-strong-password"}).status_code == 401
        updated = client.post("/api/auth/change-password", headers=bearer,
                              json={"current_password": USER_PASSWORD,
                                    "new_password": "different-strong-password"})
        assert updated.status_code == 200
        assert client.get("/api/objects", headers=bearer).status_code == 401
        assert login(client, user["username"]).status_code == 401
        assert login(client, user["username"], "different-strong-password").status_code == 200


def test_cannot_remove_the_last_enabled_named_admin(accounts):
    _, remember = accounts
    with TestClient(app) as client:
        admin = create_account(client, remember, role="admin")
        disabled = client.patch("/api/auth/users/" + admin["id"], headers=ADMIN, json={"enabled": False})
        assert disabled.status_code == 409
        demoted = client.patch("/api/auth/users/" + admin["id"], headers=ADMIN, json={"role": "viewer"})
        assert demoted.status_code == 409
        second = create_account(client, remember, role="admin")
        demoted = client.patch("/api/auth/users/" + admin["id"], headers=ADMIN, json={"role": "viewer"})
        assert demoted.status_code == 200
        assert second["role"] == "admin"


def test_shared_password_still_logs_in_and_can_bootstrap_named_accounts(accounts):
    _, remember = accounts
    with TestClient(app) as client:
        old = client.post("/api/auth/login", json={"password": SEED_PASSWORD})
        assert old.status_code == 200
        bearer = {"Authorization": "Bearer " + old.json()["access_token"]}
        profile = client.get("/api/auth/me", headers=bearer)
        assert profile.json()["role"] == "admin"
        assert profile.json()["auth_kind"] == "shared_password"
        user = client.post("/api/auth/users", headers=bearer, json={
            "username": "qa" + uuid4().hex[:12],
            "display_name": "Bootstrap test", "password": USER_PASSWORD, "role": "architect"})
        assert user.status_code == 201
        remember(user.json()["id"])


def test_token_tampering_and_revocation_are_rejected(accounts):
    config, remember = accounts
    with TestClient(app) as client:
        user = create_account(client, remember)
        token = login(client, user["username"]).json()["access_token"]
        altered = token[:-2] + ("qq" if not token.endswith("qq") else "ab")
        assert client.get("/api/objects", headers={"Authorization": "Bearer " + altered}).status_code == 401
        assert client.get("/api/objects", headers={"Authorization": "Bearer " +
            issue_user_session(config, user["id"], version=999)}).status_code == 401
        assert client.get("/api/objects", headers={"Authorization": "Bearer " + token}).status_code == 200
