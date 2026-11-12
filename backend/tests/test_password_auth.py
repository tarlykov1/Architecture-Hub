"""Password-login regression tests (temporary database and synthetic credentials only)."""
from __future__ import annotations

import time

from fastapi.testclient import TestClient
from app.main import app
from app.password_auth import (
    PasswordAuthConfig, SESSION_SECONDS, _failures,
    check_password, issue_session, login_allowed, make_password_hash, verify_session,
)

CI_PASSWORD = "test-password-for-only-CI"
CI_SIGNING_SECRET = b"development-testing-session-signing-secret-do-not-deploy"


def configured(monkeypatch):
    config = PasswordAuthConfig(make_password_hash(CI_PASSWORD), CI_SIGNING_SECRET)
    monkeypatch.setitem(app.state._state, "arch_hub_password_auth", config)
    _failures.clear()
    return config


def test_hash_has_random_salt_and_never_embeds_plaintext():
    first, second = make_password_hash(CI_PASSWORD), make_password_hash(CI_PASSWORD)
    assert first != second
    assert CI_PASSWORD not in first
    config = PasswordAuthConfig(first, CI_SIGNING_SECRET)
    assert check_password(CI_PASSWORD, config)
    assert not check_password("wrong password", config)
    assert not check_password("", config)


def test_password_exchange_returns_session_not_password(monkeypatch):
    config = configured(monkeypatch)
    with TestClient(app) as client:
        wrong = client.post("/api/auth/login", json={"password": "wrong password"})
        assert wrong.status_code == 401
        assert wrong.json()["detail"] == "Неверный логин или пароль"
        assert wrong.headers["cache-control"] == "no-store"

        logged = client.post("/api/auth/login", json={"password": CI_PASSWORD})
        assert logged.status_code == 200, logged.text
        session = logged.json()
        assert session["token_type"] == "bearer"
        assert session["expires_in"] == SESSION_SECONDS
        assert session["access_token"] != CI_PASSWORD
        assert config.password_hash not in logged.text
        assert logged.headers["cache-control"] == "no-store"
        headers = {"Authorization": "Bearer " + session["access_token"]}
        assert client.get("/api/objects", headers=headers).status_code == 200
        assert client.get("/api/networks", headers=headers).status_code == 200
        assert client.get("/api/board/layout/11111111-1111-4111-8111-111111111111", headers=headers).status_code != 401


def test_session_signature_expiry_and_wrong_signing_key(monkeypatch):
    config = configured(monkeypatch)
    token = issue_session(config)
    assert verify_session(token, config) == "admin"
    assert verify_session(token, None) is None
    assert verify_session(token, PasswordAuthConfig(config.password_hash, b"different-secret-for-tests-12345678901234")) is None
    assert verify_session(token + "modified", config) is None
    expired = issue_session(config, now=int(time.time()) - SESSION_SECONDS - 3)
    assert verify_session(expired, config) is None
    with TestClient(app) as client:
        assert client.get("/api/objects", headers={"Authorization": "Bearer " + expired}).status_code == 401
        assert client.get("/api/objects", headers={"Authorization": "Bearer " + token + "modified"}).status_code == 401


def test_login_disabled_safely_until_server_configured(monkeypatch):
    configured(monkeypatch)
    monkeypatch.setitem(app.state._state, "arch_hub_password_auth", None)
    with TestClient(app) as client:
        response = client.post("/api/auth/login", json={"password": CI_PASSWORD})
        assert response.status_code == 503
        assert CI_PASSWORD not in response.text


def test_repeated_bad_passwords_throttled(monkeypatch):
    configured(monkeypatch)
    with TestClient(app) as client:
        for _ in range(6):
            assert client.post("/api/auth/login", json={"password": "invalid"}).status_code == 401
        blocked = client.post("/api/auth/login", json={"password": CI_PASSWORD})
        assert blocked.status_code == 429
        assert blocked.headers["retry-after"] == "120"
    _failures.clear()


def test_api_keys_still_work_during_password_migration(monkeypatch):
    configured(monkeypatch)
    with TestClient(app) as client:
        response = client.get("/api/objects", headers={
            "Authorization": "Bearer ci-admin-token-123456789012345678901234"
        })
        assert response.status_code == 200


def test_password_has_minimum_strength_requirement():
    try:
        make_password_hash("123456")
    except ValueError as error:
        assert "12" in str(error)
    else:
        assert False, "Weak passwords must be rejected"
